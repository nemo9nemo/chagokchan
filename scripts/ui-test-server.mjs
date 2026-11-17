import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateNodeVersion } from "./app-runtime.mjs";
import { validateEnvironment } from "./runtime-environment.mjs";

validateNodeVersion(process.versions.node);
// Isolated loopback UI tests never load developer env files or real fixture credentials.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp)$/i.test(key)));
Object.assign(env, {
  NODE_ENV: "development", APP_ENV: "local", APP_AUTH_MODE: "local_fixture",
  APP_BASE_URL: "http://127.0.0.1:3417", SUPABASE_URL: "http://127.0.0.1:54321",
  CHAGOKCHAN_BIND_HOST: "127.0.0.1", CHAGOKCHAN_UI_TEST: "1", NEXT_TELEMETRY_DISABLED: "1",
  APP_LOCAL_FIXTURE_MANIFEST: fileURLToPath(new URL("../tmp/ui-no-real-fixtures.json", import.meta.url)),
  APP_LOCAL_CSRF_SIGNING_SECRET: randomBytes(32).toString("base64url"),
});
validateEnvironment(env, { command: "dev", bindingHost: "127.0.0.1" });
const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3417"], { env, stdio: "inherit", windowsHide: true });
child.on("error", () => { process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
