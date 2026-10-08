import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateEnvironment } from "./runtime-environment.mjs";
import { validateFixtureManifest } from "./local-fixture-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const envFile = path.join(root, ".env.development.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const env = { ...process.env, NODE_ENV: "development", CHAGOKCHAN_BIND_HOST: "127.0.0.1" };
const config = validateEnvironment(env, { command: "dev", bindingHost: "127.0.0.1" });
if (config.authMode !== "local_fixture") throw new Error("This check requires the local fixture environment.");
const manifestPath = path.join(root, "private-data", "local-fixtures.json");
const manifestStat = fs.lstatSync(manifestPath);
if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Local fixture manifest is unavailable.");
const manifest = validateFixtureManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
if (!manifest.actors[config.actor]?.id) throw new Error("The selected local fixture is not seeded.");

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const app = spawn(process.execPath, [path.join(root, "scripts", "app.mjs"), "dev"], {
  cwd: root,
  env: { ...env, APP_BASE_URL: origin, LOCAL_DEV_ACTOR: config.actor, CHAGOKCHAN_BIND_HOST: "127.0.0.1" },
  stdio: "ignore",
  windowsHide: true,
});
const appIsRunning = () => app.exitCode === null && app.signalCode === null;

try {
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (!appIsRunning()) throw new Error("The local app exited before the goal API check.");
    try {
      const response = await fetch(`${origin}/api/v1/me`, { signal: AbortSignal.timeout(4000) });
      if (response.status === 200) { ready = true; break; }
    } catch { /* Wait for the loopback Next.js server to finish starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  assert.equal(ready, true, "the authenticated local API should become ready");

  const missingGoal = await fetch(`${origin}/api/v1/goals/${crypto.randomUUID()}?actor_id=C`, {
    headers: { "x-actor-id": "C", Authorization: "Bearer invalid-test-value" },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(missingGoal.status, 404, "the configured Auth actor must reach get_goal and receive the non-disclosing 404");
  assert.match(missingGoal.headers.get("cache-control") ?? "", /no-store/i);
  assert.match(missingGoal.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  const missingBody = await missingGoal.json();
  assert.equal(missingBody.error.code, "OBJECT_NOT_AVAILABLE");
  assert.equal(/goal_not_found|database|token|secret/i.test(JSON.stringify(missingBody)), false);

  const invalidGoal = await fetch(`${origin}/api/v1/goals/not-a-uuid`, { signal: AbortSignal.timeout(10000) });
  assert.equal(invalidGoal.status, 400, "malformed path IDs must be rejected before an RPC");
  assert.equal((await invalidGoal.json()).error.code, "INVALID_INPUT");

  const csrfRequired = await fetch(`${origin}/api/v1/goals`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "검사 요청" }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(csrfRequired.status, 403, "goal creation must require the common CSRF guard before RPC");
  assert.equal((await csrfRequired.json()).error.code, "ACTION_FORBIDDEN");

  process.stdout.write(JSON.stringify({ status: "passed", actor: config.actor, checks: 3, fixture_credentials_printed: false, auth_tokens_returned: false, database_mutation: false }) + "\n");
} finally {
  if (appIsRunning()) app.kill("SIGTERM");
  if (appIsRunning()) {
    await Promise.race([
      new Promise((resolve) => app.once("close", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  if (appIsRunning() && process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolve) => killer.once("close", resolve));
  } else if (appIsRunning()) {
    app.kill("SIGKILL");
  }
  if (appIsRunning()) await new Promise((resolve) => app.once("close", resolve));
}
