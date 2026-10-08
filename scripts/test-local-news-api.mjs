import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateEnvironment } from "./runtime-environment.mjs";
import { validateFixtureManifest } from "./local-fixture-manifest.mjs";
import { CSRF_COOKIE_NAME } from "../src/server/api-security.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const envFile = path.join(root, ".env.development.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const manifestPath = path.join(root, "private-data", "local-fixtures.json");
const manifestStat = fs.lstatSync(manifestPath);
if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Local fixture manifest is unavailable.");
const manifest = validateFixtureManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function runActor(actor) {
  const env = { ...process.env, NODE_ENV: "development", LOCAL_DEV_ACTOR: actor, CHAGOKCHAN_BIND_HOST: "127.0.0.1" };
  const config = validateEnvironment(env, { command: "dev", bindingHost: "127.0.0.1" });
  if (config.authMode !== "local_fixture" || !manifest.actors[actor]?.id) throw new Error("Local fixture actor is unavailable.");
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  env.APP_BASE_URL = origin;
  const app = spawn(process.execPath, [path.join(root, "scripts", "app.mjs"), "dev"], {
    cwd: root, env, stdio: "ignore", windowsHide: true,
  });
  const appIsRunning = () => app.exitCode === null && app.signalCode === null;
  const fetchApi = (pathname, init) => fetch(`${origin}${pathname}`, { ...init, signal: AbortSignal.timeout(10000), redirect: "error" });
  try {
    let ready = false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (!appIsRunning()) throw new Error("Local app exited before news API checks completed.");
      try { if ((await fetchApi("/api/v1/me")).status === 200) { ready = true; break; } } catch { /* Wait for loopback startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    assert.equal(ready, true, "the local fixture API should become ready");

    let checks = 0;
    const notifications = await fetchApi("/api/v1/notifications?limit=10");
    assert.equal(notifications.status, 200);
    assert.match(notifications.headers.get("cache-control"), /no-store/i);
    const notificationPage = await notifications.json();
    assert.equal(Array.isArray(notificationPage.items), true);
    assert.equal(notificationPage.items.length <= 10, true);
    checks += 2;

    const sent = await fetchApi("/api/v1/sent-praises?limit=10");
    assert.equal(sent.status, 200);
    assert.match(sent.headers.get("cache-control"), /no-store/i);
    const sentPage = await sent.json();
    assert.equal(Array.isArray(sentPage.items), true);
    assert.equal(sentPage.items.length <= 10, true);
    checks += 2;

    for (const [pathname, expectedStatus] of [
      ["/api/v1/notifications?actor_id=other", 400],
      ["/api/v1/notifications?limit=1&limit=2", 400],
      ["/api/v1/sent-praises?limit=51", 400],
      ["/api/v1/sent-praises?cursor=bad%20cursor", 400],
    ]) {
      assert.equal((await fetchApi(pathname)).status, expectedStatus);
      checks++;
    }

    const notificationId = "33333333-3333-4333-8333-333333333333";
    const csrf = await fetchApi("/api/v1/auth/csrf");
    assert.equal(csrf.status, 200);
    const { csrf_token: csrfToken } = await csrf.json();
    const cookieHeader = csrf.headers.get("set-cookie");
    assert.equal(typeof csrfToken, "string");
    assert.equal(cookieHeader?.startsWith(`${CSRF_COOKIE_NAME}=`), true);

    const patchPath = `/api/v1/notifications/${notificationId}`;
    const noCsrf = await fetchApi(patchPath, { method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ read: true }) });
    assert.equal(noCsrf.status, 403);
    checks++;
    const invalidBody = await fetchApi(patchPath, {
      method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrfToken, Cookie: cookieHeader.split(";", 1)[0] },
      body: JSON.stringify({ read: false }),
    });
    assert.equal(invalidBody.status, 400);
    checks++;
    const inaccessible = await fetchApi(patchPath, {
      method: "PATCH", headers: { Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrfToken, Cookie: cookieHeader.split(";", 1)[0] },
      body: JSON.stringify({ read: true }),
    });
    assert.equal(inaccessible.status, 404);
    checks++;

    return { actor, checks };
  } finally {
    app.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

for (const actor of ["A", "B", "C"]) {
  const result = await runActor(actor);
  process.stdout.write(`${result.actor}: ${result.checks}/${result.checks} notification/sent-praise API checks passed; product fixture writes 0\n`);
}
