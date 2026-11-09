import { createHash, createHmac, hkdfSync } from "node:crypto";
import policy from "../../policies/app-policy.json" with { type: "json" };
import { sessionEncryptionKey } from "../../scripts/runtime-environment.mjs";
import { sessionConfiguration } from "./deployed-session.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Provision only this derived verification key in the matching private DB
// configuration. Neither the root nor this key is an application response.
export function reauthVerifierConfiguration(env = process.env) {
  const { baseUrl } = sessionConfiguration(env);
  const keyBytes = Buffer.from(hkdfSync("sha256", sessionEncryptionKey(env), Buffer.from(baseUrl), Buffer.from("chagokchan/reauth/account.delete/v1"), 32));
  return { keyId: createHash("sha256").update(keyBytes).digest("hex"), keyBytes };
}

export function createReauthProof({ userId, sessionId, flowId }, env = process.env, now = Date.now()) {
  if (![userId, sessionId, flowId].every(value => typeof value === "string" && UUID.test(value)) || !Number.isSafeInteger(now) || now < 0) throw new Error("Invalid reauthentication context.");
  const { keyId, keyBytes } = reauthVerifierConfiguration(env);
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, kid: keyId, provider: "google", nonce: flowId,
    sub: userId, sid: sessionId, scope: "account.delete", iat: issued, exp: issued + policy.auth.reauth_ttl_seconds })).toString("base64url");
  return { p_payload: payload, p_signature: createHmac("sha256", keyBytes).update(payload).digest("base64url") };
}
