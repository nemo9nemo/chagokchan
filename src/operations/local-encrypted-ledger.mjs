import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import policy from "../../policies/app-policy.json" with { type: "json" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const validIntent = value => exact(value, ["kind", "request_id", "subject_id", "requested_at"]) && value.kind === "account" && UUID.test(value.request_id) && UUID.test(value.subject_id) && Number.isFinite(Date.parse(value.requested_at));
const failure = () => new Error("Independent ledger is unavailable.");

// A durable independent local file adapter for isolated verification/restore.
// It is NOT selected as the hosted deployment's production ledger or scheduler.
export class LocalEncryptedDeletionLedger {
  #root; #key; #source; #queue = Promise.resolve();
  constructor({ directory, key, source }) {
    if (!path.isAbsolute(directory) || !Buffer.isBuffer(key) || key.length !== 32 || !/^[a-z0-9_-]{1,64}$/.test(source)) throw failure();
    this.#root = path.resolve(directory); this.#key = Buffer.from(key); this.#source = source;
  }
  async #serialized(action) {
    const result = this.#queue.then(action); this.#queue = result.catch(() => undefined); return result;
  }
  #file(reference) { if (!UUID.test(reference)) throw failure(); return path.join(this.#root, `${reference}.json`); }
  #aad(reference) { return Buffer.from(`chagokchan/deletion-ledger/v1|${this.#source}|${reference}`); }
  async #read(reference) {
    let text;
    try { text = await fs.readFile(this.#file(reference), "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw failure(); }
    try {
      if (text.length > 8192) throw failure(); const sealed = JSON.parse(text);
      if (!exact(sealed, ["v", "iv", "tag", "ciphertext"]) || sealed.v !== 1) throw failure();
      const values = [sealed.iv, sealed.tag, sealed.ciphertext].map(value => {
        if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw failure(); const decoded = Buffer.from(value, "base64url");
        if (decoded.toString("base64url") !== value) throw failure(); return decoded;
      });
      if (values[0].length !== 12 || values[1].length !== 16) throw failure();
      const decipher = createDecipheriv("aes-256-gcm", this.#key, values[0]); decipher.setAAD(this.#aad(reference)); decipher.setAuthTag(values[1]);
      const item = JSON.parse(Buffer.concat([decipher.update(values[2]), decipher.final()]).toString("utf8"));
      if (!exact(item, ["kind", "request_id", "subject_id", "requested_at", "completed_at", "retain_until"]) || !validIntent({ kind: item.kind, request_id: item.request_id, subject_id: item.subject_id, requested_at: item.requested_at }) || item.request_id !== reference ||
          (item.completed_at === null) !== (item.retain_until === null) || (item.completed_at !== null && (!Number.isFinite(Date.parse(item.completed_at)) || !Number.isFinite(Date.parse(item.retain_until)) || Date.parse(item.retain_until) < Date.parse(item.completed_at) + policy.lifecycle.deletion_ledger_min_days_after_erasure * 86400000))) throw failure();
      return item;
    } catch { throw failure(); }
  }
  async #write(reference, item) {
    await fs.mkdir(this.#root, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.#key, iv); cipher.setAAD(this.#aad(reference));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(item), "utf8"), cipher.final()]);
    const sealed = JSON.stringify({ v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") });
    const temporary = path.join(this.#root, `${reference}.${randomUUID()}.tmp`); let handle;
    try { handle = await fs.open(temporary, "wx", 0o600); await handle.writeFile(sealed); await handle.sync(); await handle.close(); handle = null; await fs.rename(temporary, this.#file(reference)); }
    finally { if (handle) await handle.close(); await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw failure(); }); }
    if (process.platform !== "win32") { const directory = await fs.open(this.#root, "r"); try { await directory.sync(); } finally { await directory.close(); } }
    if (!(await this.#read(reference))) throw failure();
  }
  async recordIntent(intent) {
    if (!validIntent(intent)) throw failure();
    return this.#serialized(async () => {
      const existing = await this.#read(intent.request_id);
      if (existing && (existing.subject_id !== intent.subject_id || existing.kind !== intent.kind || existing.requested_at !== intent.requested_at)) throw failure();
      if (!existing) await this.#write(intent.request_id, { ...intent, completed_at: null, retain_until: null });
      return { reference: intent.request_id, request_id: intent.request_id, subject_id: intent.subject_id, kind: intent.kind };
    });
  }
  async finalize(receipt) {
    if (!exact(receipt, ["reference", "request_id", "subject_id", "kind", "completed_at"]) || receipt.reference !== receipt.request_id || !UUID.test(receipt.reference) || !Number.isFinite(Date.parse(receipt.completed_at))) throw failure();
    return this.#serialized(async () => {
      const item = await this.#read(receipt.reference);
      if (!item || item.subject_id !== receipt.subject_id || item.kind !== receipt.kind || (item.completed_at !== null && item.completed_at !== receipt.completed_at) || Date.parse(receipt.completed_at) < Date.parse(item.requested_at)) throw failure();
      const completed = { ...item, completed_at: receipt.completed_at, retain_until: new Date(Date.parse(receipt.completed_at) + policy.lifecycle.deletion_ledger_min_days_after_erasure * 86400000).toISOString() };
      if (item.completed_at === null) await this.#write(receipt.reference, completed);
      return { ...receipt, retain_until: completed.retain_until };
    });
  }
  async readForRestore(reference) { return this.#read(reference); }
}
