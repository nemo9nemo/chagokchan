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
      if (!appIsRunning()) throw new Error("Local app exited before board API checks completed.");
      try { if ((await fetchApi("/api/v1/me")).status === 200) { ready = true; break; } } catch { /* Wait for loopback startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    assert.equal(ready, true, "the local fixture API should become ready");

    let checks = 0;
    const personalBoard = "20000000-0000-4000-8000-000000000001";
    const sharedBoard = "20000000-0000-4000-8000-000000000002";
    const personal = await fetchApi(`/api/v1/boards/${personalBoard}`);
    assert.equal(personal.status, actor === "A" ? 200 : 404);
    if (actor === "A") assert.equal((await personal.json()).kind, "personal");
    checks++;

    const shared = await fetchApi(`/api/v1/boards/${sharedBoard}`);
    assert.equal(shared.status, actor === "C" ? 404 : 200);
    if (actor !== "C") {
      const projection = await shared.json();
      assert.equal(projection.viewer_role, actor === "A" ? "owner" : "contributor");
      if (actor === "B") assert.equal("goal_id" in projection, false);
    }
    checks++;

    const sharedBoards = await fetchApi("/api/v1/shared-boards?limit=50");
    assert.equal(sharedBoards.status, 200);
    const directory = await sharedBoards.json();
    assert.equal(Array.isArray(directory.items), true);
    assert.equal(directory.next_cursor, null);
    if (actor === "B") assert.equal(directory.items.some((board) => board.id === sharedBoard && board.viewer_role === "contributor"), true);
    else assert.equal(directory.items.some((board) => board.id === sharedBoard), false);
    checks++;

    const members = await fetchApi(`/api/v1/boards/${sharedBoard}/members`);
    assert.equal(members.status, actor === "A" ? 200 : 404);
    if (actor === "A") assert.equal(Array.isArray((await members.json()).items), true);
    checks++;

    const praises = await fetchApi(`/api/v1/boards/${sharedBoard}/praises`);
    assert.equal(praises.status, actor === "C" ? 404 : 200);
    checks++;

    const malformed = await fetchApi("/api/v1/boards/not-a-uuid");
    assert.equal(malformed.status, 400);
    checks++;

    const invalidMemberQuery = await fetchApi(`/api/v1/boards/${sharedBoard}/members?actor_id=${actor}`);
    assert.equal(invalidMemberQuery.status, 400);
    checks++;

    const invalidDirectoryQuery = await fetchApi("/api/v1/shared-boards?actor_id=" + actor);
    assert.equal(invalidDirectoryQuery.status, 400);
    checks++;

    const praiseId = crypto.randomUUID();
    for (const [pathname, method, body, headers] of [
      [`/api/v1/boards/${sharedBoard}/praises`, "POST", { message: "검증" }, { "Idempotency-Key": crypto.randomUUID() }],
      [`/api/v1/boards/${sharedBoard}/members/${crypto.randomUUID()}`, "PUT", { role: "contributor" }, {}],
      [`/api/v1/boards/${sharedBoard}/members/${crypto.randomUUID()}`, "DELETE", {}, {}],
      [`/api/v1/praises/${praiseId}/hide`, "POST", {}, {}],
      [`/api/v1/praises/${praiseId}/unhide`, "POST", {}, {}],
      [`/api/v1/praises/${praiseId}/exclude`, "POST", {}, {}],
    ]) {
      const response = await fetchApi(pathname, { method, headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
      assert.equal(response.status, 403);
      checks++;
    }
    return { actor, checks };
  } finally {
    app.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

for (const actor of ["A", "B", "C"]) {
  const result = await runActor(actor);
  process.stdout.write(`${result.actor}: ${result.checks}/${result.checks} board/praise/directory role and mutation-boundary checks passed; product fixture writes 0\n`);
}
