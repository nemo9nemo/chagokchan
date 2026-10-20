import assert from "node:assert/strict";
import test from "node:test";
import { commonSecurityHeaders, documentSecurityHeaders, STATIC_CONTENT_SECURITY_POLICY } from "../src/server/security-headers.mjs";

function directives(value) {
  return Object.fromEntries(value.split(";").map(item => item.trim().split(/\s+/)).filter(item => item[0]).map(([name, ...sources]) => [name, sources]));
}

test("production CSP permits only nonce scripts and rejects inline handlers/eval/foreign connections", () => {
  const { nonce, contentSecurityPolicy } = documentSecurityHeaders();
  const policy = directives(contentSecurityPolicy);
  assert.equal(Buffer.from(nonce, "base64").length, 32);
  assert.ok(policy["script-src"].includes(`'nonce-${nonce}'`));
  assert.ok(policy["script-src"].includes("'strict-dynamic'"));
  assert.equal(policy["script-src"].includes("'unsafe-inline'"), false);
  assert.equal(policy["script-src"].includes("'unsafe-eval'"), false);
  assert.deepEqual(policy["script-src-attr"], ["'none'"]);
  assert.deepEqual(policy["connect-src"], ["'self'"]);
  assert.deepEqual(policy["worker-src"], ["'self'"]);
  for (const directive of ["object-src", "base-uri", "frame-ancestors"]) assert.deepEqual(policy[directive], ["'none'"]);
  assert.deepEqual(policy["form-action"], ["'self'"]);
  assert.ok(Object.hasOwn(policy, "upgrade-insecure-requests"));
});

test("nonce is unpredictable per response and production styles use it with a style-attribute-only exception", () => {
  const values = Array.from({ length: 100 }, () => documentSecurityHeaders());
  assert.equal(new Set(values.map(item => item.nonce)).size, 100);
  for (const { nonce, contentSecurityPolicy } of values) {
    const policy = directives(contentSecurityPolicy);
    assert.deepEqual(policy["style-src"], ["'self'", `'nonce-${nonce}'`]);
    assert.deepEqual(policy["style-src-attr"], ["'unsafe-inline'"]);
  }
});

test("development permits debugging/HMR without upgrading local HTTP to HTTPS", () => {
  const policy = directives(documentSecurityHeaders({ development: true }).contentSecurityPolicy);
  assert.ok(policy["script-src"].includes("'unsafe-eval'"));
  assert.ok(policy["connect-src"].includes("ws://127.0.0.1:*"));
  assert.equal(Object.hasOwn(policy, "upgrade-insecure-requests"), false);
  assert.equal(commonSecurityHeaders()["Strict-Transport-Security"], undefined);
});

test("shared headers prevent framing, MIME sniffing, referrer and device permission leaks; HSTS applies in production", () => {
  const headers = commonSecurityHeaders({ production: true });
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000");
  assert.match(headers["Permissions-Policy"], /camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\)/);
});

test("static/offline policy allows no scripts but preserves same-origin service-worker fetches", () => {
  const policy = directives(STATIC_CONTENT_SECURITY_POLICY);
  assert.deepEqual(policy["default-src"], ["'none'"]);
  assert.deepEqual(policy["script-src"], ["'none'"]);
  assert.deepEqual(policy["connect-src"], ["'self'"]);
  assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
});
