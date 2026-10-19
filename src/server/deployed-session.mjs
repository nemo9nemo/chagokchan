import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import policy from "../../policies/app-policy.json" with { type: "json" };
import { sessionEncryptionKey, validateEnvironment } from "../../scripts/runtime-environment.mjs";
import { validateMeProjection } from "./local-user-session.mjs";

// Only the server writes this encrypted, host-only HttpOnly cookie. There is no
// browser Supabase client, shared authenticated client, or automatic refresh.
export const SESSION_COOKIE_NAME = `${policy.auth.cookie_prefix}${policy.auth.cookie_base_name}`;
const MAX_COOKIE_LENGTH = 3800;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SessionDependencyError extends Error {
  constructor() { super("Session verification is unavailable."); }
}

export class SessionAccountError extends Error {
  constructor(state) {
    super("The app account is unavailable.");
    this.accountState = state;
  }
}

function configuration(env) {
  const config = validateEnvironment(env, { command: "start" });
  if (config.authMode !== "supabase_session" || !isPublishableKey(env.SUPABASE_PUBLISHABLE_KEY)) throw new SessionDependencyError();
  return config;
}

function isPublishableKey(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
    // Legacy anon keys are still valid configuration. Never accept a legacy
    // service_role JWT (or an sb_secret key) in the ordinary app client slot.
    return JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8")).role === "anon";
  } catch { return false; }
}

function validTokens(value) {
  return value && typeof value.access_token === "string" && value.access_token.length <= 2600 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.access_token) &&
    typeof value.refresh_token === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(value.refresh_token);
}

export function sealSession(tokens, env = process.env, now = Date.now()) {
  const config = configuration(env);
  const key = sessionEncryptionKey(env);
  if (!validTokens(tokens)) throw new SessionDependencyError();
  const issued = Math.floor(now / 1000);
  const value = { v: 1, issued_at: issued, expires_at: issued + policy.auth.session_max_age_seconds,
    access_token: tokens.access_token, refresh_token: tokens.refresh_token };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${SESSION_COOKIE_NAME}|${config.baseUrl}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const encoded = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  if (encoded.length > MAX_COOKIE_LENGTH) throw new SessionDependencyError();
  return encoded;
}

export function openSession(value, env = process.env, now = Date.now()) {
  const config = configuration(env);
  const key = sessionEncryptionKey(env);
  if (typeof value !== "string" || value.length > MAX_COOKIE_LENGTH || !/^[A-Za-z0-9_-]{40,}$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value || bytes.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${SESSION_COOKIE_NAME}|${config.baseUrl}`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    const seconds = Math.floor(now / 1000);
    if (Object.keys(session).sort().join("|") !== "access_token|expires_at|issued_at|refresh_token|v" ||
        session.v !== 1 || !Number.isSafeInteger(session.issued_at) || !Number.isSafeInteger(session.expires_at) ||
        session.issued_at > seconds + 60 || session.expires_at <= seconds ||
        session.expires_at - session.issued_at !== policy.auth.session_max_age_seconds || !validTokens(session)) return null;
    return session;
  } catch { return null; }
}

export function sessionCookieValue(header) {
  if (!header) return null;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  // Ambiguous cookies fail closed instead of selecting an attacker-controlled one.
  if (values.length !== 1) return null;
  return values[0].slice(SESSION_COOKIE_NAME.length + 1);
}

export function sessionCookieHeader(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{40,3800}$/.test(value)) throw new SessionDependencyError();
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; Max-Age=${policy.auth.session_max_age_seconds}; Secure; HttpOnly; SameSite=Lax`;
}

export function expiredSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}

function tokenIdentity(token, now) {
  // This decode is only a shape/expiry check. Auth.getUser verifies the token,
  // and get_me independently checks auth.sessions plus the active app account.
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (!UUID.test(claims.sub) || !UUID.test(claims.session_id) || claims.role !== "authenticated" ||
        !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(now / 1000)) return null;
    return claims.sub;
  } catch { return null; }
}

export async function resolveVerifiedAuthSession(cookieHeader, { env = process.env, now = Date.now(), clientFactory = createClient } = {}) {
  const config = configuration(env);
  // Check the key even on unauthenticated requests so broken release setup is
  // visible as 503 rather than silently resembling an ordinary signed-out user.
  const session = openSession(sessionCookieValue(cookieHeader), env, now);
  if (!session) return null;
  const expectedId = tokenIdentity(session.access_token, now);
  if (!expectedId) return null;
  const client = clientFactory(config.supabaseUrl, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
      fetch: (input, init) => fetch(input, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) }),
    },
  });
  let userResult;
  try { userResult = await client.auth.getUser(session.access_token); } catch { throw new SessionDependencyError(); }
  if (userResult.error) {
    if ([400, 401, 403].includes(userResult.error.status)) return null;
    throw new SessionDependencyError();
  }
  if (!userResult.data?.user || userResult.data.user.id !== expectedId || userResult.data.user.is_anonymous !== false) return null;
  return { client, userId: expectedId };
}

export async function resolveDeployedSession(cookieHeader, options = {}) {
  const verified = await resolveVerifiedAuthSession(cookieHeader, options);
  if (!verified) return null;
  const { client, userId: expectedId } = verified;
  let accountResult;
  try { accountResult = await client.rpc("get_me"); } catch { throw new SessionDependencyError(); }
  if (accountResult.error) {
    if (["PT401", "PGRST301", "PGRST303"].includes(accountResult.error.code)) return null;
    if (accountResult.error.code === "PT403" && accountResult.error.message === "signup_required") throw new SessionAccountError("signup_required");
    if (accountResult.error.code === "PT403") throw new SessionAccountError("unavailable");
    throw new SessionDependencyError();
  }
  let me;
  try { me = validateMeProjection(accountResult.data, expectedId); } catch { throw new SessionDependencyError(); }
  return { client, me, userId: expectedId };
}
