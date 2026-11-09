import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createReauthProof, reauthVerifierConfiguration } from "../src/server/reauth-proof.mjs";

const env = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://proof.example.invalid", SUPABASE_URL: "https://database.example.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only", CSRF_SIGNING_SECRET: "proof-test-csrf-material-at-least-32-bytes", AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 66).toString("base64url") };
const context = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", flowId: "33333333-3333-4333-8333-333333333333" };
const now = Date.parse("2026-11-09T09:00:00Z");

test("reauth proof has only the fixed Google deletion purpose and a ten-minute lifetime", () => {
  const signed = createReauthProof({ ...context, scope: "admin", provider: "password" }, env, now);
  const proof = JSON.parse(Buffer.from(signed.p_payload, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(proof).sort(), ["exp", "iat", "kid", "nonce", "provider", "scope", "sid", "sub", "v"]);
  assert.equal(proof.sub, context.userId); assert.equal(proof.sid, context.sessionId); assert.equal(proof.nonce, context.flowId);
  assert.equal(proof.provider, "google"); assert.equal(proof.scope, "account.delete"); assert.equal(proof.exp - proof.iat, 600);
  assert.equal(proof.iat, now / 1000); assert.match(proof.kid, /^[0-9a-f]{64}$/); assert.match(signed.p_signature, /^[A-Za-z0-9_-]{43}$/);
});

test("verification key is separated from the root, another origin and another root key", () => {
  const key = reauthVerifierConfiguration(env);
  assert.equal(key.keyBytes.length, 32); assert.notEqual(key.keyBytes.toString("base64url"), env.AUTH_SESSION_ENCRYPTION_KEY);
  const otherOrigin = reauthVerifierConfiguration({ ...env, APP_BASE_URL: "https://other.example.invalid" });
  const otherRoot = reauthVerifierConfiguration({ ...env, AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 67).toString("base64url") });
  assert.notEqual(key.keyId, otherOrigin.keyId); assert.notEqual(key.keyId, otherRoot.keyId);
  const signed = createReauthProof(context, env, now);
  assert.notEqual(createHmac("sha256", otherOrigin.keyBytes).update(signed.p_payload).digest("base64url"), signed.p_signature);
  assert.notEqual(createHmac("sha256", key.keyBytes).update(`${signed.p_payload}A`).digest("base64url"), signed.p_signature);
});

test("malformed identities and timestamps cannot be signed", () => {
  for (const value of [{ ...context, userId: null }, { ...context, sessionId: "caller-chosen" }, { ...context, flowId: "" }]) assert.throws(() => createReauthProof(value, env, now));
  for (const value of [NaN, -1, 1.5]) assert.throws(() => createReauthProof(context, env, value));
});

test("invalid deployment material cannot derive a usable verifier key", () => {
  for (const change of [{ AUTH_SESSION_ENCRYPTION_KEY: "missing" }, { SUPABASE_PUBLISHABLE_KEY: "sb_secret_not_allowed" }, { APP_AUTH_MODE: "local_fixture" }, { APP_BASE_URL: "http://127.0.0.1:3000" }]) assert.throws(() => reauthVerifierConfiguration({ ...env, ...change }));
});
