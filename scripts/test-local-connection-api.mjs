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
const manifestPath = path.join(root, "private-data", "local-fixtures.json");
const manifestStat = fs.lstatSync(manifestPath);
if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Local fixture manifest is unavailable.");
const manifest = validateFixtureManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));

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

async function runActor(actor) {
  const env = { ...process.env, NODE_ENV: "development", LOCAL_DEV_ACTOR: actor, CHAGOKCHAN_BIND_HOST: "127.0.0.1" };
  const config = validateEnvironment(env, { command: "dev", bindingHost: "127.0.0.1" });
  if (config.authMode !== "local_fixture" || !manifest.actors[actor]?.id) throw new Error("Local fixture actor is not available.");
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  env.APP_BASE_URL = origin;
  const app = spawn(process.execPath, [path.join(root, "scripts", "app.mjs"), "dev"], {
    cwd: root,
    env,
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
      if (!appIsRunning()) throw new Error("Local app exited before connection API checks completed.");
      try {
        const readyResponse = await response(`${origin}/api/v1/me`);
        if (readyResponse.status === 200) { ready = true; break; }
      } catch { /* Wait until the loopback server finishes starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    assert.equal(ready, true, "the authenticated local API should become ready");

    for (const pathName of ["connections", "connection-invites", "connection-requests", "blocks"]) {
      const list = await response(`${origin}/api/v1/${pathName}`);
      assert.equal(list.status, 200, `${actor} should read ${pathName}`);
      const page = await list.json();
      assert.equal(Array.isArray(page.items), true);
      assert.equal(page.next_cursor, null);
      assert.match(list.headers.get("cache-control") ?? "", /no-store/i);
      if (pathName === "connection-invites") assert.equal(JSON.stringify(page).includes("link_path"), false);
    }

    for (const query of ["limit=1&limit=2", "limit=51", "actor_id=" + actor]) {
      const invalid = await response(`${origin}/api/v1/connections?${query}`);
      assert.equal(invalid.status, 400);
    }

    const csrfResponse = await response(`${origin}/api/v1/auth/csrf`);
    assert.equal(csrfResponse.status, 200);
    const csrfPayload = await csrfResponse.json();
    const csrfHeaders = {
      Origin: origin,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfPayload.csrf_token,
      Cookie: `chagokchan_csrf=${csrfPayload.csrf_token}`,
    };

    const noCsrfInvite = await response(`${origin}/api/v1/connection-invites`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(noCsrfInvite.status, 403);

    const invalidPreview = await response(`${origin}/api/v1/connection-invites/preview`, {
      method: "POST", headers: csrfHeaders, body: JSON.stringify({ code: "OOOOOOOOOOOO" }),
    });
    assert.equal(invalidPreview.status, 400);

    const invalidRequest = await response(`${origin}/api/v1/connection-requests`, {
      method: "POST", headers: { ...csrfHeaders, "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ link_token: "invalid" }),
    });
    assert.equal(invalidRequest.status, 400);

    const invalidBlock = await response(`${origin}/api/v1/blocks`, {
      method: "POST", headers: csrfHeaders, body: JSON.stringify({ user_id: crypto.randomUUID(), actor_id: "forbidden" }),
    });
    assert.equal(invalidBlock.status, 400);

    const unknownConnection = await response(`${origin}/api/v1/connections/${crypto.randomUUID()}`, {
      method: "DELETE", headers: csrfHeaders, body: "{}",
    });
    assert.equal(unknownConnection.status, 404);
    assert.equal((await unknownConnection.json()).error.code, "OBJECT_NOT_AVAILABLE");
    return { actor, checks: 12 };
  } finally {
    app.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

for (const actor of ["A", "B", "C"]) {
  const result = await runActor(actor);
  process.stdout.write(`${result.actor}: ${result.checks}/${result.checks} connection API read and boundary checks passed; fixture writes 0\n`);
}
