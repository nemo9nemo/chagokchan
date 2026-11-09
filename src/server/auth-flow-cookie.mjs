import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import policy from "../../policies/app-policy.json" with { type: "json" };
import { sessionEncryptionKey } from "../../scripts/runtime-environment.mjs";
import { sessionConfiguration } from "./deployed-session.mjs";

export const FLOW_COOKIE_NAME = "__Host-chagokchan_oauth";
export const INVITE_COOKIE_NAME = "__Host-chagokchan_invite";
export const FLOW_TTL = policy.auth.oauth_flow_ttl_seconds;
const SECRET = /^[A-Za-z0-9_-]{32}$/;
const HASH = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const allowedNextPath = value => value === "/" || value === "/connect";
export const validInviteToken = value => typeof value === "string" && SECRET.test(value);

export function cookieValue(header, name) {
  const values = (header ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

export function temporaryCookieHeader(name, value = "", maxAge = FLOW_TTL) {
  if (![FLOW_COOKIE_NAME, INVITE_COOKIE_NAME].includes(name) || !/^[A-Za-z0-9_-]{0,2000}$/.test(value) ||
      !Number.isSafeInteger(maxAge) || maxAge < 0 || maxAge > FLOW_TTL) throw new Error("Invalid auth cookie.");
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

function seal(name, value, env, now) {
  const { baseUrl } = sessionConfiguration(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionEncryptionKey(env), iv);
  cipher.setAAD(Buffer.from(`${name}|${baseUrl}`));
  const payload = JSON.stringify({ v: 1, issued_at: Math.floor(now / 1000), ...value });
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

function open(header, name, env, now) {
  const { baseUrl } = sessionConfiguration(env);
  const value = cookieValue(header, name);
  if (!value || value.length > 2000 || !/^[A-Za-z0-9_-]{40,}$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return null;
    const decipher = createDecipheriv("aes-256-gcm", sessionEncryptionKey(env), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${name}|${baseUrl}`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    const seconds = Math.floor(now / 1000);
    if (data.v !== 1 || !Number.isSafeInteger(data.issued_at) || data.issued_at > seconds + 60 || data.issued_at + FLOW_TTL <= seconds) return null;
    return data;
  } catch { return null; }
}

export function sealLoginFlow(value, env, now = Date.now()) {
  if (!HASH.test(value.verifier) || !HASH.test(value.binding) || !allowedNextPath(value.next) ||
      (value.invite_token !== null && !validInviteToken(value.invite_token))) throw new Error("Invalid login flow.");
  return seal(FLOW_COOKIE_NAME, value, env, now);
}

export function openLoginFlow(header, env, now = Date.now()) {
  const value = open(header, FLOW_COOKIE_NAME, env, now);
  return value && Object.keys(value).sort().join("|") === "binding|invite_token|issued_at|next|v|verifier" &&
    HASH.test(value.verifier) && HASH.test(value.binding) && allowedNextPath(value.next) &&
    (value.invite_token === null || validInviteToken(value.invite_token)) ? value : null;
}

export function sealPendingInvite(inviteToken, claims, env, now = Date.now()) {
  if (!validInviteToken(inviteToken) || !UUID.test(claims.userId) || !UUID.test(claims.sessionId)) throw new Error("Invalid pending invite.");
  return seal(INVITE_COOKIE_NAME, { invite_token: inviteToken, user_id: claims.userId, session_id: claims.sessionId }, env, now);
}

export function openPendingInvite(header, claims, env, now = Date.now()) {
  const value = open(header, INVITE_COOKIE_NAME, env, now);
  if (!claims || !value || Object.keys(value).sort().join("|") !== "invite_token|issued_at|session_id|user_id|v" ||
      value.user_id !== claims.userId || value.session_id !== claims.sessionId || !validInviteToken(value.invite_token)) return null;
  return value.invite_token;
}
