import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// Uses only an isolated production build-check environment. No real provider,
// local auto-login or production database is connected by this HTTP probe.
const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(env)) if (key.startsWith("LOCAL_DEV_") || key.startsWith("APP_LOCAL_")) delete env[key];
Object.assign(env, {
  APP_ENV: "preview", APP_AUTH_MODE: "supabase_session",
  APP_BASE_URL: "https://build-check.example.invalid", SUPABASE_URL: "https://database.example.invalid",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_build_check_only",
  CSRF_SIGNING_SECRET: "build-check-only-csrf-key-not-for-runtime",
  AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 66).toString("base64url"),
});
const expected = fs.readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
if (process.versions.node !== expected) throw new Error("Use the pinned Node runtime.");
const base = "http://127.0.0.1:3199";
const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "start", "--hostname", "127.0.0.1", "--port", "3199"], { env, windowsHide: true, stdio: "ignore" });
let childError = false;
child.on("error", () => { childError = true; });
const checks = [];
function check(name, run) { run(); checks.push({ name, status: "passed" }); }
const request = (path, init) => fetch(base + path, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (childError || child.exitCode !== null) throw new Error("Isolated production server did not start.");
    try { if ((await request("/")).ok) { ready = true; break; } } catch {}
    await setTimeout(500);
  }
  if (!ready) throw new Error("Isolated production server was not ready.");
  const first = await request("/", { headers: { "x-nonce": "attacker", "content-security-policy": "script-src 'nonce-attacker'" } });
  const html = await first.text();
  const csp = first.headers.get("content-security-policy");
  const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => match[0]);
  check("HTML overwrites forged nonce/CSP and permits no inline scripts or eval", () => {
    assert.equal(first.status, 200);
    assert.ok(nonce && nonce !== "attacker");
    assert.ok(csp.includes("'strict-dynamic'"));
    assert.ok(!csp.includes("'unsafe-eval'") && !csp.match(/script-src[^;]*'unsafe-inline'/));
  });
  check("all generated Next.js script tags carry the response nonce", () => {
    assert.ok(scripts.length > 0);
    for (const script of scripts) assert.ok(script.includes(`nonce="${nonce}"`));
  });
  const second = await request("/");
  check("HTML nonce changes for every request and documents cannot be cached", () => {
    assert.notEqual(second.headers.get("content-security-policy")?.match(/'nonce-([^']+)'/)?.[1], nonce);
    for (const response of [first, second]) assert.match(response.headers.get("cache-control"), /no-store/);
  });
  check("HTTPS deployment headers include HSTS, no-referrer, framing and device restrictions", () => {
    assert.equal(first.headers.get("strict-transport-security"), "max-age=31536000");
    assert.equal(first.headers.get("referrer-policy"), "no-referrer");
    assert.equal(first.headers.get("x-frame-options"), "DENY");
    assert.equal(first.headers.get("x-content-type-options"), "nosniff");
    assert.match(first.headers.get("permissions-policy"), /camera=\(\)/);
  });
  const api = await request("/api/v1/goals");
  check("production rejects missing authentication and keeps API errors out of caches", () => {
    assert.equal(api.status, 401);
    assert.match(api.headers.get("cache-control"), /no-store/);
  });
  const sw = await request("/sw.js");
  check("service worker is revalidated with a script-free same-origin fetch policy", () => {
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get("cache-control"), /no-store/);
    assert.match(sw.headers.get("content-security-policy"), /script-src 'none'/);
    assert.match(sw.headers.get("content-security-policy"), /connect-src 'self'/);
  });
  const offline = await request("/offline.html");
  check("only the public offline page is immutable and contains no executable scripts", () => {
    assert.equal(offline.status, 200);
    assert.match(offline.headers.get("cache-control"), /public.*immutable/);
    assert.match(offline.headers.get("content-security-policy"), /script-src 'none'/);
  });
  assert.equal(/<script\b/i.test(await offline.text()), false);
  const report = { verified_at: new Date().toISOString(), scope: "isolated_production_http_headers_not_browser_or_real_auth_acceptance", next: JSON.parse(fs.readFileSync(new URL("../node_modules/next/package.json", import.meta.url))).version, passed: checks.length, checks };
  fs.mkdirSync(new URL("../tmp", import.meta.url), { recursive: true });
  fs.writeFileSync(new URL("../tmp/security-headers-http.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
} finally {
  if (child.exitCode === null && !childError) {
    const ended = once(child, "exit");
    child.kill();
    await ended;
  }
}
