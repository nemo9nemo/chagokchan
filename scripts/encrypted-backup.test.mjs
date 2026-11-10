import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { encryptBackupArchive, decryptBackupArchive } from "../src/operations/encrypted-backup.mjs";
const fixture = () => ({ archive: Buffer.concat([Buffer.from("PGDMP"), randomBytes(4096)]), options: { key: randomBytes(32), source: "isolated-source", createdAt: "2026-11-10T15:00:00.000Z" } });
test("backup encryption round-trips bytes with fresh IVs", () => {
  const { archive, options } = fixture(), first = encryptBackupArchive(archive, options), second = encryptBackupArchive(archive, options);
  assert.ok(!first.equals(second)); assert.ok(!first.includes(archive)); assert.ok(decryptBackupArchive(first, options).equals(archive)); assert.ok(decryptBackupArchive(second, options).equals(archive));
});
test("wrong key, source, snapshot timestamp and ciphertext tampering cannot open a backup", () => {
  const { archive, options } = fixture(), sealed = encryptBackupArchive(archive, options);
  for (const changed of [{ ...options, key: randomBytes(32) }, { ...options, source: "different-source" }, { ...options, createdAt: "2026-11-10T15:00:00.001Z" }]) assert.throws(() => decryptBackupArchive(sealed, changed), /Encrypted backup is unavailable/);
  for (const index of [0, 25, 40, sealed.length - 1]) { const changed = Buffer.from(sealed); changed[index] ^= 1; assert.throws(() => decryptBackupArchive(changed, options)); }
});
test("non-archive input and invalid key or context fail before encryption", () => {
  const { archive, options } = fixture();
  for (const value of ["PGDMP", Buffer.from("SQL text"), Buffer.alloc(0)]) assert.throws(() => encryptBackupArchive(value, options));
  for (const changed of [{ ...options, key: randomBytes(31) }, { ...options, source: "source|other" }, { ...options, createdAt: "2026-11-10" }]) assert.throws(() => encryptBackupArchive(archive, changed));
});
test("missing or truncated archive envelopes never return partial plaintext", () => {
  const { archive, options } = fixture(), sealed = encryptBackupArchive(archive, options);
  for (const value of [null, "invalid", Buffer.alloc(0), sealed.subarray(0, 10), sealed.subarray(0, sealed.length - 1)]) assert.throws(() => decryptBackupArchive(value, options));
});
