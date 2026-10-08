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

async function response(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10000), redirect: "error" });
}

try {
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (!appIsRunning()) throw new Error("The local app exited before the personal-praise API check.");
    try {
      const readyResponse = await response(`${origin}/api/v1/me`);
      if (readyResponse.status === 200) { ready = true; break; }
    } catch { /* Wait for the loopback Next.js server to finish starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  assert.equal(ready, true, "the authenticated local API should become ready");

  const checks = [];
  const seededGoal = await response(`${origin}/api/v1/goals/10000000-0000-4000-8000-000000000001?actor_id=${config.actor}`, {
    headers: { "x-actor-id": config.actor, Authorization: "Bearer invalid-test-value" },
  });
  assert.equal(seededGoal.status, config.actor === "A" ? 200 : 404);
  checks.push("server_actor_ignores_client_identity_inputs");

  const missingBoardId = crypto.randomUUID();
  const hiddenBoard = await response(`${origin}/api/v1/boards/${missingBoardId}/praises?include_hidden=false`);
  assert.equal(hiddenBoard.status, 404);
  assert.equal((await hiddenBoard.json()).error.code, "OBJECT_NOT_AVAILABLE");
  assert.match(hiddenBoard.headers.get("cache-control") ?? "", /no-store/i);
  checks.push("unavailable_board_uses_hidden_no_store_response");

  const malformedBoard = await response(`${origin}/api/v1/boards/not-a-uuid/praises`);
  assert.equal(malformedBoard.status, 400);
  checks.push("malformed_board_id_is_rejected");

  for (const query of ["bunch_id=not-a-uuid", "limit=1&limit=2", "include_hidden=yes", "actor_id=" + config.actor]) {
    const invalidQuery = await response(`${origin}/api/v1/boards/${missingBoardId}/praises?${query}`);
    assert.equal(invalidQuery.status, 400);
  }
  checks.push("bunch_limit_hidden_and_actor_query_inputs_are_bounded");

  const praiseId = crypto.randomUUID();
  const noCsrfCreate = await response(`${origin}/api/v1/boards/${missingBoardId}/praises`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": praiseId },
    body: JSON.stringify({ message: "CSRF boundary" }),
  });
  assert.equal(noCsrfCreate.status, 403);
  assert.equal((await noCsrfCreate.json()).error.code, "ACTION_FORBIDDEN");
  checks.push("create_requires_csrf_before_rpc");

  const noCsrfEdit = await response(`${origin}/api/v1/praises/${praiseId}`, {
    method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ message: "CSRF boundary" }),
  });
  assert.equal(noCsrfEdit.status, 403);
  checks.push("edit_requires_csrf_before_rpc");

  const noCsrfCancel = await response(`${origin}/api/v1/praises/${praiseId}/cancel`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(noCsrfCancel.status, 403);
  checks.push("cancel_requires_csrf_before_rpc");

  const csrfResponse = await response(`${origin}/api/v1/auth/csrf`);
  assert.equal(csrfResponse.status, 200);
  const csrfBody = await csrfResponse.json();
  assert.match(csrfBody.csrf_token, /^[A-Za-z0-9_.-]+$/);
  const csrfHeaders = {
    Origin: origin,
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfBody.csrf_token,
    Cookie: `chagokchan_csrf=${csrfBody.csrf_token}`,
  };
  const validCsrfCreate = await response(`${origin}/api/v1/boards/${missingBoardId}/praises`, {
    method: "POST", headers: { ...csrfHeaders, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ message: null, occurred_on: null }),
  });
  assert.equal(validCsrfCreate.status, 404);
  assert.equal((await validCsrfCreate.json()).error.code, "OBJECT_NOT_AVAILABLE");
  checks.push("valid_csrf_create_maps_missing_personal_board_without_exposing_database_detail");

  const validCsrfEdit = await response(`${origin}/api/v1/praises/${praiseId}`, {
    method: "PATCH", headers: csrfHeaders, body: JSON.stringify({ message: "변경" }),
  });
  assert.equal(validCsrfEdit.status, 404);
  assert.equal((await validCsrfEdit.json()).error.code, "OBJECT_NOT_AVAILABLE");
  checks.push("valid_csrf_edit_maps_missing_praise_safely");

  const validCsrfCancel = await response(`${origin}/api/v1/praises/${praiseId}/cancel`, {
    method: "POST", headers: csrfHeaders, body: "{}",
  });
  assert.equal(validCsrfCancel.status, 404);
  assert.equal((await validCsrfCancel.json()).error.code, "OBJECT_NOT_AVAILABLE");
  checks.push("valid_csrf_cancel_maps_missing_praise_safely");

  process.stdout.write(JSON.stringify({ status: "passed", actor: config.actor, checks: checks.length, cases: checks, fixture_credentials_printed: false, auth_tokens_returned: false, product_database_mutation: false }) + "\n");
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
