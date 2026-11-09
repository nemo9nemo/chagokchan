import test from "node:test";
import assert from "node:assert/strict";
import { PINNED_NODE_VERSION, serverBinding, validateNodeVersion } from "./app-runtime.mjs";

const config = { appEnv: "production", authMode: "supabase_session", baseUrl: "https://example.invalid" };
const local = { appEnv: "local", authMode: "local_fixture", baseUrl: "http://127.0.0.1:3000" };

test("local and CI require the exact pinned security runtime", () => {
  validateNodeVersion(PINNED_NODE_VERSION);
  for (const version of ["24.19.0", "24.22.2", "22.23.4", "25.0.0"]) assert.throws(() => validateNodeVersion(version));
});
test("deployed runtime accepts forward patches in the approved major", () => {
  for (const version of [PINNED_NODE_VERSION, "24.22.2", "24.23.0"]) validateNodeVersion(version, { deployed: true });
});
test("deployed runtime rejects vulnerable older, other-major and prerelease versions", () => {
  for (const version of ["24.19.0", "24.22.0", "22.23.4", "25.0.0", "24.22.1-rc.1", "24.22", "", undefined]) {
    assert.throws(() => validateNodeVersion(version, { deployed: true }));
  }
});
test("development remains loopback and uses the configured local URL port", () => {
  assert.deepEqual(serverBinding("dev", {}, local), { host: "127.0.0.1", port: "3000" });
  assert.throws(() => serverBinding("dev", { APP_BIND_HOST: "0.0.0.0" }, local));
});
test("production supports an explicit container binding and platform port", () => {
  assert.deepEqual(serverBinding("start", { APP_BIND_HOST: "0.0.0.0", PORT: "10000" }, config), { host: "0.0.0.0", port: "10000" });
  assert.deepEqual(serverBinding("start", {}, config), { host: "127.0.0.1", port: "3000" });
});
test("fixture configuration cannot use production network binding", () => {
  assert.throws(() => serverBinding("start", { APP_BIND_HOST: "0.0.0.0" }, local));
});
test("invalid host and port fail without echoing supplied values", () => {
  for (const host of ["example.invalid", "127.0.0.1;private", "::"]) {
    assert.throws(() => serverBinding("start", { APP_BIND_HOST: host }, config), error => !error.message.includes(host));
  }
  for (const port of ["0", "65536", "-1", "3000 private", "1e3", "03000", "", 3000]) {
    assert.throws(() => serverBinding("start", { PORT: port }, config), error => error.message === "Invalid configuration: PORT");
  }
});
