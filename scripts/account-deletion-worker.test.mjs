import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { processAccountDeletion, runAccountDeletionBatch, DeletionWorkError } from "../src/operations/account-deletion-worker.mjs";
import { LocalEncryptedDeletionLedger } from "../src/operations/local-encrypted-ledger.mjs";

const id = "11111111-1111-4111-8111-111111111111", uid = "22222222-2222-4222-8222-222222222222", other = "33333333-3333-4333-8333-333333333333";
const requestedAt = "2026-11-01T00:00:00+00:00", completedAt = "2026-11-02T00:00:00+00:00";
function fixture({ intentFailure = false, mismatchedReceipt = false, authFailure = false, lookupFailure = false, finalizeFailure = false, shortRetention = false, extendedWork = false } = {}) {
  const calls = [], work = { request_id: id, subject_id: uid, status: "pending", checkpoint: "access_revoked", ledger_reference: null, requested_at: requestedAt, completed_at: null, ledger_acknowledged: false };
  let authPresent = true;
  const client = { rpc: async (name, args) => {
    calls.push(name);
    if (name === "get_account_deletion_work") return { data: { ...work, ...(extendedWork ? { email: "private@example.invalid" } : {}) }, error: null };
    if (name === "list_account_deletion_work") return { data: { items: work.ledger_acknowledged ? [] : [{ request_id: id }] }, error: null };
    if (name === "process_account_deletion") { assert.equal(args.p_request_id, id); assert.equal(args.p_ledger_reference, id); work.status = "running"; work.checkpoint = "app_data_erased"; work.ledger_reference = id; return { data: { id, status: "running", checkpoint: "app_data_erased", auth_delete_required: true }, error: null }; }
    if (name === "complete_account_deletion") { assert.equal(authPresent, false); work.status = "completed"; work.checkpoint = "auth_removed"; work.completed_at = completedAt; return { data: { id, status: "completed", replayed: false }, error: null }; }
    if (name === "ack_account_deletion_ledger") { work.ledger_acknowledged = true; return { data: { id, ledger_acknowledged: true }, error: null }; }
    if (name === "fail_account_deletion") { if (work.status !== "completed") work.status = "failed"; return { data: {}, error: null }; }
    throw new Error("Unexpected RPC");
  } };
  const authAdmin = { deleteUser: async subject => { calls.push("auth.delete"); assert.equal(subject, uid); if (authFailure) return { error: { status: 503, message: "private-provider-secret" } }; authPresent = false; return { error: null }; }, getUserById: async subject => { calls.push("auth.verify_absent"); assert.equal(subject, uid); return { error: { status: lookupFailure ? 503 : 404, code: "user_not_found" } }; } };
  const ledger = { recordIntent: async () => { calls.push("ledger.intent"); if (intentFailure) throw new Error("private-ledger-secret"); return { reference: id, request_id: id, subject_id: mismatchedReceipt ? other : uid, kind: "account" }; }, finalize: async receipt => { calls.push("ledger.finalize"); if (finalizeFailure) throw new Error("private-ledger-secret"); return { ...receipt, retain_until: new Date(Date.parse(receipt.completed_at) + (shortRetention ? 1 : 37) * 86400000).toISOString() }; } };
  return { calls, work, dependencies: { client, authAdmin, ledger, requestId: id } };
}
test("durable intent precedes app erasure, Auth absence precedes completion and ledger finalization precedes acknowledgement", async () => {
  const { calls, work, dependencies } = fixture(); assert.deepEqual(await processAccountDeletion(dependencies), { completed: true, replayed: false });
  for (const [earlier, later] of [["ledger.intent", "process_account_deletion"], ["process_account_deletion", "auth.delete"], ["auth.verify_absent", "complete_account_deletion"], ["complete_account_deletion", "ledger.finalize"], ["ledger.finalize", "ack_account_deletion_ledger"]]) assert.ok(calls.indexOf(earlier) < calls.indexOf(later));
  assert.equal(work.ledger_acknowledged, true);
});
test("missing or mismatched durable intent prevents both data and Auth erasure", async () => {
  for (const config of [{ intentFailure: true }, { mismatchedReceipt: true }]) { const { calls, dependencies } = fixture(config); await assert.rejects(processAccountDeletion(dependencies), error => error instanceof DeletionWorkError && error.code === "deletion_ledger_write_failed"); assert.equal(calls.includes("process_account_deletion"), false); assert.equal(calls.includes("auth.delete"), false); }
});
test("Auth outage and unavailable absence lookup cannot mark work completed or expose raw errors", async () => {
  for (const config of [{ authFailure: true }, { lookupFailure: true }]) { const { calls, dependencies } = fixture(config); await assert.rejects(processAccountDeletion(dependencies), error => error.code === "auth_user_delete_failed" && !error.message.includes("private")); assert.equal(calls.includes("complete_account_deletion"), false); }
});
test("failed or too-short finalization remains unacknowledged and retries without deleting again", async () => {
  for (const config of [{ finalizeFailure: true }, { shortRetention: true }]) { const f = fixture(config); await assert.rejects(processAccountDeletion(f.dependencies), error => error.code === "deletion_ledger_write_failed"); assert.equal(f.work.status, "completed"); assert.equal(f.work.ledger_acknowledged, false); f.calls.length = 0; f.dependencies.ledger.finalize = async receipt => ({ ...receipt, retain_until: "2026-12-10T00:00:00Z" }); await processAccountDeletion(f.dependencies); assert.equal(f.calls.includes("auth.delete"), false); assert.equal(f.work.ledger_acknowledged, true); }
});
test("acknowledged replay is read-only and malformed job projections fail closed", async () => {
  const f = fixture(); await processAccountDeletion(f.dependencies); f.calls.length = 0; assert.deepEqual(await processAccountDeletion(f.dependencies), { completed: true, replayed: true }); assert.deepEqual(f.calls, ["get_account_deletion_work"]);
  const expanded = fixture({ extendedWork: true }); await assert.rejects(processAccountDeletion(expanded.dependencies)); assert.equal(expanded.calls.includes("ledger.intent"), false);
});
test("batch is bounded and reports counts without subject identifiers", async () => {
  const f = fixture(); const summary = await runAccountDeletionBatch(f.dependencies); assert.deepEqual(summary, { selected: 1, completed: 1, failed: 0 }); assert.ok(!JSON.stringify(summary).includes(uid));
  for (const limit of [0, 26, 1.5]) await assert.rejects(runAccountDeletionBatch({ ...f.dependencies, limit }));
});
test("independent file ledger is encrypted, restart-persistent, idempotent and retains completed markers for 37 days", async () => {
  const directory = path.resolve(".cache", `ledger-test-${crypto.randomUUID()}`), key = crypto.randomBytes(32), source = "isolated-test";
  const ledger = new LocalEncryptedDeletionLedger({ directory, key, source });
  const intent = { kind: "account", request_id: id, subject_id: uid, requested_at: requestedAt };
  const [first, again] = await Promise.all([ledger.recordIntent(intent), ledger.recordIntent(intent)]); assert.deepEqual(first, again);
  const contents = await fs.readFile(path.join(directory, `${id}.json`), "utf8"); assert.ok(!contents.includes(uid) && !contents.includes("account"));
  const restarted = new LocalEncryptedDeletionLedger({ directory, key, source }); assert.equal((await restarted.readForRestore(id)).retain_until, null);
  const finalized = await restarted.finalize({ ...first, completed_at: completedAt }); assert.equal(Date.parse(finalized.retain_until) - Date.parse(completedAt), 37 * 86400000); assert.deepEqual(await restarted.finalize({ ...first, completed_at: completedAt }), finalized);
  await fs.unlink(path.join(directory, `${id}.json`)); await fs.rmdir(directory);
});
test("ledger tampering, wrong source/key and conflicting target cannot produce a receipt", async () => {
  const directory = path.resolve(".cache", `ledger-test-${crypto.randomUUID()}`), key = crypto.randomBytes(32), ledger = new LocalEncryptedDeletionLedger({ directory, key, source: "isolated-test" });
  const intent = { kind: "account", request_id: id, subject_id: uid, requested_at: requestedAt }; await ledger.recordIntent(intent);
  await assert.rejects(ledger.recordIntent({ ...intent, subject_id: other })); await assert.rejects(ledger.recordIntent({ ...intent, email: "private@example.invalid" }));
  for (const config of [{ key: crypto.randomBytes(32), source: "isolated-test" }, { key, source: "another-source" }]) await assert.rejects(new LocalEncryptedDeletionLedger({ directory, ...config }).readForRestore(id));
  const file = path.join(directory, `${id}.json`), sealed = JSON.parse(await fs.readFile(file, "utf8")); const bytes = Buffer.from(sealed.ciphertext, "base64url"); bytes[0] ^= 1; sealed.ciphertext = bytes.toString("base64url"); await fs.writeFile(file, JSON.stringify(sealed)); await assert.rejects(ledger.readForRestore(id));
  await fs.unlink(file); await fs.rmdir(directory);
});
