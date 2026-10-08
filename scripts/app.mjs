import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { validateEnvironment } from "./runtime-environment.mjs";
const command = process.argv[2];
if (!["dev", "build", "build-check", "start"].includes(command)) throw new Error("Use dev, build, build-check or start.");
const expected = fs.readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
if (process.versions.node !== expected) throw new Error(`Node ${expected} is required. Use scripts/project.ps1 or your Node version manager.`);
if (command === "dev" && fs.existsSync(".env.development.local")) process.loadEnvFile(".env.development.local");
const env = { ...process.env, NODE_ENV: command === "dev" ? "development" : "production", NEXT_TELEMETRY_DISABLED: "1" };
if (command === "build-check") {
  for (const key of Object.keys(env)) if (key.startsWith("LOCAL_DEV_")) delete env[key];
  Object.assign(env, { APP_ENV: "preview", APP_AUTH_MODE: "supabase_session", APP_BASE_URL: "https://build-check.example.invalid", SUPABASE_URL: "https://database.example.invalid" });
}
const bindingHost = "127.0.0.1";
if (command === "dev") env.CHAGOKCHAN_BIND_HOST = bindingHost;
const config = validateEnvironment(env, { command: command === "dev" ? "dev" : "build", bindingHost });
if (command === "dev") env.APP_LOCAL_FIXTURE_MANIFEST = fileURLToPath(new URL("../private-data/local-fixtures.json", import.meta.url));
const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const port = new URL(config.baseUrl).port || (command === "dev" ? "80" : "443");
const args = command === "dev" ? ["dev", "--hostname", bindingHost, "--port", port] : command === "start" ? ["start", "--hostname", bindingHost] : ["build"];
const child = spawn(process.execPath, [next, ...args], { stdio: "inherit", env, windowsHide: true });
child.on("error", (error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
