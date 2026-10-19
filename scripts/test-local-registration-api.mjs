import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateEnvironment } from "./runtime-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.loadEnvFile(path.join(root, ".env.development.local"));
const env = { ...process.env, NODE_ENV: "development", CHAGOKCHAN_BIND_HOST: "127.0.0.1" };
const config = validateEnvironment(env, { command: "dev", bindingHost: "127.0.0.1" });
assert.equal(config.authMode, "local_fixture");
const socket = net.createServer();
await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, [path.join(root, "scripts/app.mjs"), "dev"], {
  cwd: root, env: { ...env, APP_BASE_URL: origin, LOCAL_DEV_ACTOR: config.actor }, stdio: "ignore", windowsHide: true,
});
const running = () => app.exitCode === null && app.signalCode === null;
const checks = [];
let phase = "server_start";
let failed = false;
const check = async (name, work) => { phase = name; await work(); checks.push({ name, status: "passed" }); };
function headersChecked(response) {
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
}
try {
  const deadline = Date.now() + 90000;
  let baseline;
  while (Date.now() < deadline) {
    if (!running()) throw new Error("Test server stopped.");
    try {
      const response = await fetch(`${origin}/api/v1/me`, { signal: AbortSignal.timeout(4000) });
      if (response.status === 200) { baseline = await response.json(); break; }
    } catch { /* Wait for the loopback server. */ }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  assert.ok(baseline);
  const csrfResponse = await fetch(`${origin}/api/v1/auth/csrf`);
  assert.equal(csrfResponse.status, 200);
  const csrf = (await csrfResponse.json()).csrf_token;
  const post = (body, { withCsrf = true, foreignOrigin = false } = {}) => fetch(`${origin}/api/v1/me/bootstrap`, {
    method: "POST", headers: { origin: foreignOrigin ? "https://foreign.example.invalid" : origin, "content-type": "application/json",
      ...(withCsrf ? { "x-csrf-token": csrf, cookie: `chagokchan_csrf=${csrf}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const body = { adult_confirmed: true, registration_policy_version: "0.2.0" };
  await check("auth_context_is_self_only_and_no_store", async () => {
    const response = await fetch(`${origin}/api/v1/auth/session?user_id=untrusted`, { headers: { "x-user-id": "untrusted" } });
    assert.equal(response.status, 200); headersChecked(response);
    assert.deepEqual(await response.json(), { user_id: baseline.user_id, account_state: "active", next: "/" });
  });
  await check("registration_requires_csrf", async () => { const response = await post(body, { withCsrf: false }); assert.equal(response.status, 403); headersChecked(response); });
  await check("registration_requires_explicit_confirmation", async () => { const response = await post({ ...body, adult_confirmed: false }); assert.equal(response.status, 400); headersChecked(response); });
  await check("registration_rejects_identity_override", async () => { const response = await post({ ...body, user_id: baseline.user_id }); assert.equal(response.status, 400); headersChecked(response); });
  await check("registration_rejects_cross_origin", async () => { const response = await post(body, { foreignOrigin: true }); assert.equal(response.status, 403); headersChecked(response); });
  await check("active_retry_returns_original_confirmation", async () => { const response = await post(body); assert.equal(response.status, 200); headersChecked(response); assert.deepEqual(await response.json(), baseline); });
  await check("older_version_active_retry_keeps_original_record", async () => { const response = await post({ ...body, registration_policy_version: "0.1.0" }); assert.equal(response.status, 200); headersChecked(response); assert.deepEqual(await response.json(), baseline); });
  await check("account_projection_is_unchanged_after_retries", async () => { const response = await fetch(`${origin}/api/v1/me`); assert.equal(response.status, 200); assert.deepEqual(await response.json(), baseline); });
} catch {
  failed = true; checks.push({ name: phase, status: "failed" });
} finally {
  if (running()) app.kill("SIGTERM");
  if (running()) await Promise.race([new Promise(resolve => app.once("close", resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
  if (running() && process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise(resolve => killer.once("close", resolve));
  } else if (running()) app.kill("SIGKILL");
  if (running()) await new Promise(resolve => app.once("close", resolve));
}
const report = { checked_at: new Date().toISOString(), work_item: "W12-B", actor: config.actor,
  status: !failed && checks.length === 8 ? "passed" : "failed", executed: checks.length,
  passed: checks.filter(c => c.status === "passed").length, checks,
  existing_active_registration_retries_only: true, real_google_otp_tests_executed: 0, tokens_returned_or_logged: false };
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync(`tmp/local-registration-api-${config.actor}.json`, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (report.status !== "passed") process.exitCode = 1;
