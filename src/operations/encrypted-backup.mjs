import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const magic = Buffer.from("CHAGOKCHAN_BACKUP_V1\n");
const unavailable = () => new Error("Encrypted backup is unavailable.");
function context({ key, source, createdAt }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !/^[a-z0-9_-]{1,64}$/.test(source) || typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw unavailable();
  return Buffer.from(`chagokchan/database-backup/v1|${source}|${createdAt}`);
}
export function encryptBackupArchive(archive, options) {
  const aad = context(options);
  if (!Buffer.isBuffer(archive) || archive.subarray(0, 5).toString() !== "PGDMP" || archive.length > 64 * 1024 * 1024) throw unavailable();
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", options.key, iv); cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]);
}
export function decryptBackupArchive(sealed, options) {
  const aad = context(options), offset = magic.length;
  if (!Buffer.isBuffer(sealed) || sealed.length <= offset + 28 || sealed.length > 64 * 1024 * 1024 + offset + 28 || !sealed.subarray(0, offset).equals(magic)) throw unavailable();
  try {
    const decipher = createDecipheriv("aes-256-gcm", options.key, sealed.subarray(offset, offset + 12));
    decipher.setAAD(aad); decipher.setAuthTag(sealed.subarray(offset + 12, offset + 28));
    const archive = Buffer.concat([decipher.update(sealed.subarray(offset + 28)), decipher.final()]);
    if (archive.subarray(0, 5).toString() !== "PGDMP") throw unavailable();
    return archive;
  } catch { throw unavailable(); }
}
