import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiRequestError,
  CSRF_COOKIE_NAME,
  CSRF_TTL_SECONDS,
  createCsrfToken,
  csrfCookieHeader,
  getCsrfSigningSecret,
  validateMutationRequest,
  verifyCsrfToken,
} from "../src/server/api-security.mjs";

const secret = Buffer.alloc(32, 7);
const origin = "http://127.0.0.1:3000";
const token = () => createCsrfToken(secret);
function request(options = {}) {
  const csrfToken = options.token ?? token();
  const headers = new Headers({
    Origin: origin,
    "Content-Type": "application/json; charset=utf-8",
    "X-CSRF-Token": csrfToken,
    Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
  });
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request(`${origin}/api/v1/example`, {
    method: "POST",
    headers,
    body: options.body ?? JSON.stringify({ ok: true }),
  });
}

test("CSRF token signs a nonce and expires at the configured lifetime", () => {
  const issued = 1_800_000_000_000;
  const value = createCsrfToken(secret, issued);
  assert.equal(verifyCsrfToken(value, secret, issued + (CSRF_TTL_SECONDS - 1) * 1000), true);
  assert.equal(verifyCsrfToken(value, secret, issued + CSRF_TTL_SECONDS * 1000), false);
});

test("CSRF token rejects alteration, another signing key, and malformed token", () => {
  const value = token();
  assert.equal(verifyCsrfToken(value + "x", secret), false);
  assert.equal(verifyCsrfToken(value, Buffer.alloc(32, 8)), false);
  assert.equal(verifyCsrfToken("not.a.valid.token", secret), false);
});

test("CSRF secret is required for local and deployed modes", () => {
  assert.throws(() => getCsrfSigningSecret({ APP_AUTH_MODE: "local_fixture" }));
  assert.throws(() => getCsrfSigningSecret({ APP_AUTH_MODE: "supabase_session" }));
  assert.equal(getCsrfSigningSecret({ APP_AUTH_MODE: "supabase_session", CSRF_SIGNING_SECRET: "x".repeat(32) }).byteLength, 32);
});

test("CSRF cookie is HttpOnly, same-site, API-scoped, and secure when deployed", () => {
  const value = token();
  assert.match(csrfCookieHeader(value), /HttpOnly; SameSite=Lax/);
  assert.match(csrfCookieHeader(value), /Path=\/api\/v1/);
  assert.match(csrfCookieHeader(value, { secure: true }), /; Secure$/);
});

test("same-origin signed double-submit request returns the parsed object", async () => {
  const csrfToken = token();
  const result = await validateMutationRequest(request({ token: csrfToken }), { expectedOrigin: origin, secret });
  assert.deepEqual(result, { ok: true });
});

for (const [name, options] of [
  ["missing Origin", { headers: { Origin: null } }],
  ["foreign Origin", { headers: { Origin: "https://attacker.example" } }],
  ["cross-site Fetch Metadata", { headers: { "Sec-Fetch-Site": "cross-site" } }],
  ["missing CSRF header", { headers: { "X-CSRF-Token": null } }],
  ["different CSRF cookie", { headers: { Cookie: `${CSRF_COOKIE_NAME}=different` } }],
  ["unsigned CSRF header", { token: "attacker-controlled-token" }],
]) {
  test(`mutation request rejects ${name}`, async () => {
    await assert.rejects(validateMutationRequest(request(options), { expectedOrigin: origin, secret }),
      (error) => error instanceof ApiRequestError && error.status === 403);
  });
}

test("mutation request rejects a non-JSON body", async () => {
  await assert.rejects(validateMutationRequest(request({ headers: { "Content-Type": "text/plain" } }), { expectedOrigin: origin, secret }),
    (error) => error instanceof ApiRequestError && error.status === 400);
});

test("mutation request enforces the declared and actual byte limit", async () => {
  const tooLarge = "x".repeat(32769);
  await assert.rejects(validateMutationRequest(request({ body: JSON.stringify({ data: tooLarge }) }), { expectedOrigin: origin, secret }),
    (error) => error instanceof ApiRequestError && error.status === 413);
  await assert.rejects(validateMutationRequest(request({ headers: { "Content-Length": "32769" } }), { expectedOrigin: origin, secret }),
    (error) => error instanceof ApiRequestError && error.status === 413);
});

test("mutation request rejects invalid JSON and non-object JSON", async () => {
  await assert.rejects(validateMutationRequest(request({ body: "{" }), { expectedOrigin: origin, secret }),
    (error) => error instanceof ApiRequestError && error.status === 400);
  await assert.rejects(validateMutationRequest(request({ body: "[1]" }), { expectedOrigin: origin, secret }),
    (error) => error instanceof ApiRequestError && error.status === 400);
});
