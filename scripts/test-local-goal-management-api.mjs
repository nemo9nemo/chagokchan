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
const checks = [];

async function readJson(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
}

try {
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (!appIsRunning()) throw new Error("The local app exited before the goal management API check.");
    try {
      const response = await readJson(`${origin}/api/v1/me`);
      if (response.status === 200) { ready = true; break; }
    } catch { /* Wait for the loopback Next.js server to finish starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  assert.equal(ready, true, "the authenticated local API should become ready");

  const seededGoals = await readJson(`${origin}/api/v1/goals?actor_id=${config.actor === "A" ? "C" : "A"}`, {
    headers: { "x-actor-id": config.actor === "A" ? "C" : "A", Authorization: "Bearer invalid-test-value" },
  });
  assert.equal(seededGoals.status, 200);
  const page = await seededGoals.json();
  assert.equal(page.items.some((item) => item.id === "10000000-0000-4000-8000-000000000001"), config.actor === "A");
  checks.push("server_actor_ignores_client_identity_inputs");

  for (const action of ["complete", "archive", "resume"]) {
    const response = await readJson(`${origin}/api/v1/goals/50000000-0000-4000-8000-000000000001/${action}?actor_id=C`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", "x-actor-id": "C", Authorization: "Bearer invalid-test-value" },
      body: JSON.stringify({ expected_revision: 1 }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "ACTION_FORBIDDEN");
    checks.push(`${action}_requires_csrf_before_rpc`);
  }

  const boardMutation = await readJson(`${origin}/api/v1/boards/50000000-0000-4000-8000-000000000001?actor_id=C`, {
    method: "PATCH",
    headers: { Origin: origin, "Content-Type": "application/json", "x-actor-id": "C", Authorization: "Bearer invalid-test-value" },
    body: JSON.stringify({ expected_revision: 1, next_target_count: 5 }),
  });
  assert.equal(boardMutation.status, 403);
  assert.equal((await boardMutation.json()).error.code, "ACTION_FORBIDDEN");
  checks.push("board_update_requires_csrf_before_rpc");

  const invalidBoard = await readJson(`${origin}/api/v1/boards/not-a-uuid/bunches`);
  assert.equal(invalidBoard.status, 400);
  assert.equal((await invalidBoard.json()).error.code, "INVALID_INPUT");
  checks.push("malformed_board_id_is_rejected");

  const invalidLimit = await readJson(`${origin}/api/v1/boards/50000000-0000-4000-8000-000000000001/bunches?limit=51`);
  assert.equal(invalidLimit.status, 400);
  assert.equal((await invalidLimit.json()).error.code, "INVALID_INPUT");
  checks.push("bunch_page_size_is_bounded");

  const privateBoard = await readJson(`${origin}/api/v1/boards/50000000-0000-4000-8000-000000000001/bunches`);
  assert.equal(privateBoard.status, 404);
  assert.equal((await privateBoard.json()).error.code, "OBJECT_NOT_AVAILABLE");
  assert.match(privateBoard.headers.get("cache-control") ?? "", /no-store/i);
  checks.push("unavailable_board_has_hidden_404_and_no_store");

  process.stdout.write(JSON.stringify({ status: "passed", actor: config.actor, checks: checks.length, cases: checks, fixture_credentials_printed: false, auth_tokens_returned: false, database_mutation: false }) + "\n");
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
