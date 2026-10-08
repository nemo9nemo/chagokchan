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
const expectedUserId = manifest.actors[config.actor]?.id;
if (!expectedUserId) throw new Error("The selected local fixture is not seeded.");

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
const appEnv = {
  ...env,
  APP_BASE_URL: `http://127.0.0.1:${port}`,
  LOCAL_DEV_ACTOR: config.actor,
  CHAGOKCHAN_BIND_HOST: "127.0.0.1",
};
const app = spawn(process.execPath, [path.join(root, "scripts", "app.mjs"), "dev"], {
  cwd: root,
  env: appEnv,
  stdio: "ignore",
  windowsHide: true,
});
const appIsRunning = () => app.exitCode === null && app.signalCode === null;
const endpoint = `http://127.0.0.1:${port}/api/v1/me?user_id=${manifest.actors.C.id ?? "unknown"}&actor_id=C`;

try {
  let response;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (!appIsRunning()) throw new Error("The local app exited before the API check.");
    try {
      response = await fetch(endpoint, {
        headers: {
          "x-user-id": manifest.actors.C.id ?? "unknown",
          "x-actor-id": "C",
          Authorization: "Bearer invalid-test-value",
        },
        signal: AbortSignal.timeout(4000),
      });
      if (response.status !== 503) break;
    } catch {
      // Wait for the loopback Next.js server to finish starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  assert.ok(response, "the local API should start on loopback");
  assert.equal(response.status, 200, "GET /api/v1/me should use the configured local Auth session");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["account_status", "adult_confirmed_at", "profile", "registration_policy_version", "timezone", "user_id"].sort());
  assert.equal(body.user_id, expectedUserId, "client-supplied actor identifiers must not select the user");
  assert.equal(body.profile.user_id, expectedUserId);
  assert.equal(body.account_status, "active");
  assert.equal(/access_token|refresh_token|password|service_role/i.test(JSON.stringify(body)), false);

  const csrfResponse = await fetch(`http://127.0.0.1:${port}/api/v1/auth/csrf`, { signal: AbortSignal.timeout(4000) });
  assert.equal(csrfResponse.status, 200, "GET /api/v1/auth/csrf should issue a local flow token");
  assert.match(csrfResponse.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  assert.match(csrfResponse.headers.get("cache-control") ?? "", /no-store/i);
  const csrfBody = await csrfResponse.json();
  assert.equal(typeof csrfBody.csrf_token, "string");
  assert.ok(csrfBody.csrf_token.length >= 16 && csrfBody.csrf_token.length <= 1024);
  const csrfCookie = csrfResponse.headers.get("set-cookie") ?? "";
  assert.ok(csrfCookie.startsWith(`chagokchan_csrf=${csrfBody.csrf_token};`));
  assert.match(csrfCookie, /HttpOnly/);
  assert.match(csrfCookie, /SameSite=Lax/);
  assert.match(csrfCookie, /Path=\/api\/v1/);
  process.stdout.write(JSON.stringify({ status: "passed", actor: config.actor, checks: 15, fixture_credentials_printed: false, auth_tokens_returned: false }) + "\n");
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
