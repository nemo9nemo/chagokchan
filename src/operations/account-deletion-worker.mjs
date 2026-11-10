import policy from "../../policies/app-policy.json" with { type: "json" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set(["pending", "running", "failed", "completed"]);
const CHECKPOINTS = new Set(["access_revoked", "ledger_recorded", "app_data_erased", "auth_removed"]);
export class DeletionWorkError extends Error {
  constructor(code) { super("Account deletion work is unavailable."); this.code = code; }
}
const unavailable = () => new DeletionWorkError("account_erase_failed");
const exact = (data, keys) => data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).sort().join("|") === [...keys].sort().join("|");

async function rpc(client, name, args) {
  let result; try { result = await client.rpc(name, args); } catch { throw unavailable(); }
  if (result.error) throw unavailable(); return result.data;
}
async function loadWork(client, requestId) {
  const item = await rpc(client, "get_account_deletion_work", { p_request_id: requestId });
  if (!exact(item, ["request_id", "subject_id", "status", "checkpoint", "ledger_reference", "requested_at", "completed_at", "ledger_acknowledged"]) ||
      item.request_id !== requestId || !UUID.test(item.subject_id) || !STATES.has(item.status) || !CHECKPOINTS.has(item.checkpoint) ||
      (item.ledger_reference !== null && !UUID.test(item.ledger_reference)) || !Number.isFinite(Date.parse(item.requested_at)) ||
      (item.completed_at !== null && !Number.isFinite(Date.parse(item.completed_at))) || typeof item.ledger_acknowledged !== "boolean" ||
      (item.status === "completed") !== (item.completed_at !== null) || (item.status === "completed" && (item.checkpoint !== "auth_removed" || item.ledger_reference === null)) ||
      (item.ledger_acknowledged && item.status !== "completed")) throw unavailable();
  return item;
}
function boundReceipt(receipt, work) {
  return exact(receipt, ["reference", "request_id", "subject_id", "kind"]) && UUID.test(receipt.reference) && receipt.request_id === work.request_id &&
    receipt.subject_id === work.subject_id && receipt.kind === "account" && (work.ledger_reference === null || receipt.reference === work.ledger_reference);
}
const absent = result => result?.error?.status === 404 && [undefined, "user_not_found", "not_found"].includes(result.error.code);

// Privileged operations only. No ordinary app route imports or instantiates it.
// ledger must acknowledge a durable, independent write before data erasure.
export async function processAccountDeletion({ client, authAdmin, ledger, requestId }) {
  if (!UUID.test(requestId)) throw unavailable();
  let work;
  try {
    work = await loadWork(client, requestId);
    if (work.ledger_acknowledged) return { completed: true, replayed: true };
    let receipt;
    try { receipt = await ledger.recordIntent({ request_id: work.request_id, subject_id: work.subject_id, kind: "account", requested_at: work.requested_at }); }
    catch { throw new DeletionWorkError("deletion_ledger_write_failed"); }
    if (!boundReceipt(receipt, work)) throw new DeletionWorkError("deletion_ledger_write_failed");
    if (work.status !== "completed") {
      let erased;
      try { erased = await rpc(client, "process_account_deletion", { p_request_id: requestId, p_ledger_reference: receipt.reference }); }
      catch { const latest = await loadWork(client, requestId); if (latest.status !== "completed" || latest.subject_id !== work.subject_id || latest.ledger_reference !== receipt.reference) throw unavailable(); work = latest; }
      if (work.status !== "completed") {
        if (!exact(erased, ["id", "status", "checkpoint", "auth_delete_required"]) || erased.id !== requestId || erased.status !== "running" || erased.checkpoint !== "app_data_erased" || erased.auth_delete_required !== true) throw unavailable();
        // Delete only the subject selected by the checked DB job. Never accept
        // an email, browser UUID or provider identity as an administrative target.
        try {
          const removed = await authAdmin.deleteUser(work.subject_id);
          if (removed.error && !absent(removed)) throw new Error("Auth removal unavailable");
          const remaining = await authAdmin.getUserById(work.subject_id);
          if (!absent(remaining)) throw new Error("Auth identity still present or lookup unavailable");
        } catch { throw new DeletionWorkError("auth_user_delete_failed"); }
        const completed = await rpc(client, "complete_account_deletion", { p_request_id: requestId });
        if (!exact(completed, ["id", "status", "replayed"]) || completed.id !== requestId || completed.status !== "completed" || typeof completed.replayed !== "boolean") throw unavailable();
        work = await loadWork(client, requestId);
      }
    }
    // An incomplete ledger entry has no expiry. Start the >=37-day retention
    // only after DB completion, then acknowledge it so failed finalization retries.
    try {
      const finalized = await ledger.finalize({ ...receipt, completed_at: work.completed_at });
      if (!exact(finalized, ["reference", "request_id", "subject_id", "kind", "completed_at", "retain_until"]) ||
          !boundReceipt({ reference: finalized.reference, request_id: finalized.request_id, subject_id: finalized.subject_id, kind: finalized.kind }, work) ||
          finalized.completed_at !== work.completed_at || !Number.isFinite(Date.parse(finalized.retain_until)) ||
          Date.parse(finalized.retain_until) < Date.parse(work.completed_at) + policy.lifecycle.deletion_ledger_min_days_after_erasure * 86400000) throw new Error("Invalid ledger finalization");
    }
    catch { throw new DeletionWorkError("deletion_ledger_write_failed"); }
    const ack = await rpc(client, "ack_account_deletion_ledger", { p_request_id: requestId, p_ledger_reference: receipt.reference });
    if (!exact(ack, ["id", "ledger_acknowledged"]) || ack.id !== requestId || ack.ledger_acknowledged !== true) throw unavailable();
    return { completed: true, replayed: false };
  } catch (error) {
    const safe = error instanceof DeletionWorkError ? error : unavailable();
    if (work && work.status !== "completed") {
      try { await client.rpc("fail_account_deletion", { p_request_id: requestId, p_error_code: safe.code }); } catch { /* No raw dependency errors or subjects in logs. */ }
    }
    throw safe;
  }
}

export async function runAccountDeletionBatch({ client, authAdmin, ledger, limit = 10 }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw unavailable();
  const batch = await rpc(client, "list_account_deletion_work", { p_limit: limit });
  if (!exact(batch, ["items"]) || !Array.isArray(batch.items) || batch.items.length > limit ||
      batch.items.some(item => !exact(item, ["request_id"]) || !UUID.test(item.request_id)) ||
      new Set(batch.items.map(item => item.request_id)).size !== batch.items.length) throw unavailable();
  const summary = { selected: batch.items.length, completed: 0, failed: 0 };
  for (const item of batch.items) {
    try { await processAccountDeletion({ client, authAdmin, ledger, requestId: item.request_id }); summary.completed++; }
    catch { summary.failed++; }
  }
  return summary;
}
