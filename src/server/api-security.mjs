import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import policy from "../../policies/app-policy.json" with { type: "json" };

export const CSRF_COOKIE_NAME = "chagokchan_csrf";
export const CSRF_TTL_SECONDS = 1800;

export class ApiRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asSecret(secret) {
  const value = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? "", "utf8");
  if (value.byteLength < 32) throw new Error("CSRF signing key is unavailable.");
  return value;
}

function signatureFor(payload, secret) {
  return createHmac("sha256", asSecret(secret)).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function getCsrfSigningSecret(env = process.env) {
  const secret = env.APP_AUTH_MODE === "local_fixture"
    ? env.APP_LOCAL_CSRF_SIGNING_SECRET
    : env.CSRF_SIGNING_SECRET;
  return asSecret(secret);
}

export function createCsrfToken(secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    exp: issuedAt + CSRF_TTL_SECONDS,
    iat: issuedAt,
    nonce: randomBytes(32).toString("base64url"),
    v: 1,
  })).toString("base64url");
  return `${payload}.${signatureFor(payload, secret)}`;
}

export function verifyCsrfToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || token.length < 16 || token.length > 1024) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return false;
  let expected;
  try { expected = signatureFor(parts[0], secret); } catch { return false; }
  if (!safeEqual(parts[1], expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const fields = Object.keys(payload).sort().join("|");
    if (fields !== "exp|iat|nonce|v" || payload.v !== 1 ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        payload.exp - payload.iat !== CSRF_TTL_SECONDS ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce)) return false;
    const nowSeconds = Math.floor(now / 1000);
    return payload.iat <= nowSeconds + 60 && payload.exp > nowSeconds;
  } catch {
    return false;
  }
}

function reject(status, code, message) {
  throw new ApiRequestError(status, code, message);
}

function csrfCookie(request) {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== CSRF_COOKIE_NAME) continue;
    return item.slice(separator + 1).trim();
  }
  return null;
}

async function readBoundedBody(request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d{1,10}$/.test(contentLength)) reject(400, "INVALID_INPUT", "요청 형식이 올바르지 않습니다.");
    if (Number(contentLength) > policy.limits.json_body_bytes_max) reject(413, "PAYLOAD_TOO_LARGE", "요청이 허용 크기를 초과했습니다.");
  }
  if (!request.body) reject(400, "INVALID_INPUT", "JSON 본문이 필요합니다.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > policy.limits.json_body_bytes_max) {
      await reader.cancel();
      reject(413, "PAYLOAD_TOO_LARGE", "요청이 허용 크기를 초과했습니다.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    reject(400, "INVALID_INPUT", "요청 형식이 올바르지 않습니다.");
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    reject(400, "INVALID_INPUT", "요청 형식이 올바르지 않습니다.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) reject(400, "INVALID_INPUT", "JSON 객체가 필요합니다.");
  return parsed;
}

export async function validateMutationRequest(request, { expectedOrigin, secret = getCsrfSigningSecret() }) {
  if (!expectedOrigin || request.headers.get("origin") !== expectedOrigin) {
    reject(403, "ACTION_FORBIDDEN", "요청 출처를 확인할 수 없습니다.");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") reject(403, "ACTION_FORBIDDEN", "요청 출처를 확인할 수 없습니다.");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") reject(400, "INVALID_INPUT", "JSON 요청이 필요합니다.");

  const headerToken = request.headers.get("x-csrf-token");
  const cookieToken = csrfCookie(request);
  if (!headerToken || !cookieToken || !safeEqual(headerToken, cookieToken) || !verifyCsrfToken(headerToken, secret)) {
    reject(403, "ACTION_FORBIDDEN", "요청 보안 토큰을 확인할 수 없습니다.");
  }
  return readBoundedBody(request);
}

export function csrfCookieHeader(token, { secure = false } = {}) {
  return `${CSRF_COOKIE_NAME}=${token}; Path=/api/v1; Max-Age=${CSRF_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
