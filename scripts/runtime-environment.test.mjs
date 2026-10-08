import test from "node:test";
import assert from "node:assert/strict";
import { ConfigurationError, validateEnvironment } from "./runtime-environment.mjs";
const local = { APP_ENV: "local", APP_AUTH_MODE: "local_fixture", NODE_ENV: "development", APP_BASE_URL: "http://127.0.0.1:3000", SUPABASE_URL: "http://127.0.0.1:54321", LOCAL_DEV_ACTOR: "A" };
const deployed = { APP_ENV: "staging", APP_AUTH_MODE: "supabase_session", NODE_ENV: "production", APP_BASE_URL: "https://staging.example.invalid", SUPABASE_URL: "https://database.example.invalid" };
const validateLocal = (env) => validateEnvironment(env, { command: "dev", bindingHost: "127.0.0.1" });
test("local configuration selects fixture A", () => assert.equal(validateLocal(local).actor, "A"));
test("local configuration accepts only the fixed B/C fixture names", () => {
  for (const actor of ["B", "C"]) assert.equal(validateLocal({ ...local, LOCAL_DEV_ACTOR: actor }).actor, actor);
});
test("deployed configuration requires the session mode", () => assert.equal(validateEnvironment(deployed, { command: "build" }).authMode, "supabase_session"));
for (const [title, values] of [
  ["missing mode", { APP_AUTH_MODE: undefined }],
  ["unknown mode", { APP_AUTH_MODE: "guest" }],
  ["unknown actor", { LOCAL_DEV_ACTOR: "owner-admin" }],
  ["staging fixture", { APP_ENV: "staging" }],
  ["production fixture", { APP_ENV: "production" }],
  ["preview fixture", { APP_ENV: "preview" }],
  ["release fixture", { NODE_ENV: "production" }],
  ["external database", { SUPABASE_URL: "https://cloud.supabase.co" }],
  ["unexpected local port", { SUPABASE_URL: "http://127.0.0.1:54322" }],
  ["external app URL", { APP_BASE_URL: "http://192.168.1.2:3000" }],
  ["URL credentials", { SUPABASE_URL: "http://user:secret@127.0.0.1:54321" }],
  ["URL query", { APP_BASE_URL: "http://127.0.0.1:3000/?actor=B" }],
]) test(title + " is rejected", () => assert.throws(() => validateLocal({ ...local, ...values }), ConfigurationError));
test("external binding is rejected", () => assert.throws(() => validateEnvironment(local, { command: "dev", bindingHost: "0.0.0.0" }), ConfigurationError));
test("fixture mode cannot compile a release", () => assert.throws(() => validateEnvironment(local, { command: "build", bindingHost: "127.0.0.1" }), ConfigurationError));
test("deployed mode rejects remaining fixture credentials", () => assert.throws(() => validateEnvironment({ ...deployed, LOCAL_DEV_PASSWORD: "synthetic" }, { command: "build" }), ConfigurationError));
test("deployed mode rejects local database", () => assert.throws(() => validateEnvironment({ ...deployed, SUPABASE_URL: "https://localhost:54321" }, { command: "build" }), ConfigurationError));
test("configuration failures never print credential values", () => {
  assert.throws(() => validateLocal({ ...local, SUPABASE_URL: "http://user:private-value@127.0.0.1:54321" }), (error) => error instanceof ConfigurationError && !error.message.includes("private-value"));
});
