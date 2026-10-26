import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { validateEnvironment } from "./runtime-environment.mjs";
import { warmDevelopmentRoutes } from "./dev-warmup.mjs";
const command = process.argv[2];
if (!["dev", "build", "build-check", "start"].includes(command)) throw new Error("Use dev, build, build-check or start.");
const expected = fs.readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
if (process.versions.node !== expected) throw new Error(`Node ${expected} is required. Use scripts/project.ps1 or your Node version manager.`);
if (command === "dev" && fs.existsSync(".env.development.local")) process.loadEnvFile(".env.development.local");
const env = { ...process.env, NODE_ENV: command === "dev" ? "development" : "production", NEXT_TELEMETRY_DISABLED: "1" };
if (command === "build-check") {
  for (const key of Object.keys(env)) if (key.startsWith("LOCAL_DEV_")) delete env[key];
  Object.assign(env, { APP_ENV: "preview", APP_AUTH_MODE: "supabase_session", APP_BASE_URL: "https://build-check.example.invalid", SUPABASE_URL: "https://database.example.invalid", CSRF_SIGNING_SECRET: "build-check-only-csrf-key-not-for-runtime", AUTH_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 66).toString("base64url") });
}
const bindingHost = "127.0.0.1";
if (command === "dev") env.CHAGOKCHAN_BIND_HOST = bindingHost;
const config = validateEnvironment(env, { command: command === "dev" ? "dev" : "build", bindingHost });
if (command === "dev") {
  env.APP_LOCAL_FIXTURE_MANIFEST = fileURLToPath(new URL("../private-data/local-fixtures.json", import.meta.url));
  env.APP_LOCAL_CSRF_SIGNING_SECRET = randomBytes(32).toString("base64url");
}
const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const port = new URL(config.baseUrl).port || (command === "dev" ? "80" : "443");
const args = command === "dev" ? ["dev", "--hostname", bindingHost, "--port", port] : command === "start" ? ["start", "--hostname", bindingHost] : ["build"];
const warmupEnabled = command === "dev" && env.LOCAL_DEV_WARMUP !== "0";
const warmupAbort = new AbortController();
const child = spawn(process.execPath, [next, ...args], { stdio: warmupEnabled ? ["inherit", "pipe", "inherit"] : "inherit", env, windowsHide: true });
if (warmupEnabled) {
  let readyText = "";
  let started = false;
  child.stdout.on("data", chunk => {
    process.stdout.write(chunk);
    readyText = (readyText + chunk.toString()).slice(-500);
    if (started || !readyText.includes("Ready in")) return;
    started = true;
    process.stdout.write("차곡찬: 처음 열 화면과 읽기 API를 준비하고 있어요.\n");
    void warmDevelopmentRoutes(env, { signal: warmupAbort.signal }).then(({ requests }) => {
      process.stdout.write(`차곡찬: 로컬 화면 준비 완료 (${requests}개 읽기 요청).\n`);
    }, () => {
      if (!warmupAbort.signal.aborted) process.stderr.write("차곡찬: 초기 준비 일부 실패. 화면에서 다시 시도할 수 있어요.\n");
    });
  });
}
child.on("error", (error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
child.on("exit", (code) => { warmupAbort.abort(); process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
