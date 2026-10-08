import assert from "node:assert/strict";
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
    if (!appIsRunning()) throw new Error("The local app exited before the goal list API check.");
    try {
      const response = await fetch(`${origin}/api/v1/me`, { signal: AbortSignal.timeout(4000) });
      if (response.status === 200) { ready = true; break; }
    } catch { /* Wait for the loopback Next.js server to finish starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  assert.equal(ready, true, "the authenticated local API should become ready");

  const response = await fetch(`${origin}/api/v1/goals?actor_id=C&status=active`, {
    headers: { "x-actor-id": "C", Authorization: "Bearer invalid-test-value" },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  const page = await response.json();
  assert.deepEqual(Object.keys(page).sort(), ["items", "next_cursor"]);
  assert.ok(Array.isArray(page.items));
  assert.ok(page.next_cursor === null || (typeof page.next_cursor === "string" && page.next_cursor.length <= 512));
  assert.equal(page.items.some((goal) => goal.id === "10000000-0000-4000-8000-000000000001"), config.actor === "A");
  for (const goal of page.items) {
    assert.deepEqual(Object.keys(goal).sort(), ["archived_at", "completed_at", "created_at", "id", "private_description", "revision", "status", "title"].sort());
    assert.equal(goal.status, "active");
    assert.equal(/owner_user_id|actor_user_id|other_user/i.test(JSON.stringify(goal)), false);
  }

  const invalidStatus = await fetch(`${origin}/api/v1/goals?status=deleted`, { signal: AbortSignal.timeout(10000) });
  assert.equal(invalidStatus.status, 400);
  assert.equal((await invalidStatus.json()).error.code, "INVALID_INPUT");

  const invalidLimit = await fetch(`${origin}/api/v1/goals?limit=51`, { signal: AbortSignal.timeout(10000) });
  assert.equal(invalidLimit.status, 400);
  assert.equal((await invalidLimit.json()).error.code, "INVALID_INPUT");

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
