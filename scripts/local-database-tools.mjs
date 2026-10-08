import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateEnvironment } from "./runtime-environment.mjs";
import { assertLoopbackPorts } from "./docker-loopback-proxy.mjs";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const databaseContainer = "supabase_db_chagokchan";
export function runQuiet(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot, encoding: "utf8", windowsHide: true,
    timeout: 60000, maxBuffer: 4 * 1024 * 1024, ...options,
  });
  // Commands may return credentials or user content. Never include raw output in errors.
  if (result.error || result.status !== 0) throw new Error("Local database command failed (" + (result.error?.code ?? result.status) + ").");
  return result.stdout;
}
export function supabaseCli(args) {
  const directory = path.join(projectRoot, "node_modules", "supabase");
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  const relative = typeof metadata.bin === "string" ? metadata.bin : metadata.bin.supabase;
  const executable = path.join(directory, relative);
  return executable.endsWith(".js") ? runQuiet(process.execPath, [executable, ...args]) : runQuiet(executable, args);
}
export function assertLocalDatabase() {
  if (path.resolve(process.cwd()) !== path.resolve(projectRoot)) throw new Error("Run from the project workspace.");
  if (process.versions.node !== fs.readFileSync(path.join(projectRoot, ".node-version"), "utf8").trim()) throw new Error("Use the pinned Node runtime.");
  process.loadEnvFile(path.join(projectRoot, ".env.development.local"));
  process.env.NODE_ENV ??= "development";
  const config = validateEnvironment(process.env, { command: "dev", bindingHost: "127.0.0.1" });
  if (config.authMode !== "local_fixture" || config.supabaseUrl !== "http://127.0.0.1:54321") throw new Error("This command only supports the local fixture database.");
  const toml = fs.readFileSync(path.join(projectRoot, "supabase/config.toml"), "utf8");
  if (!/^project_id = "chagokchan"$/m.test(toml)) throw new Error("Unexpected local project.");
  const context = runQuiet("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"] ).trim();
  for (const endpoint of [process.env.DOCKER_HOST, context].filter(Boolean)) {
    if (!endpoint.startsWith("npipe:////./pipe/") && !endpoint.startsWith("unix:///")) throw new Error("Remote Docker endpoints are not supported.");
  }
  const ports = JSON.parse(runQuiet("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", databaseContainer]));
  if (!ports["5432/tcp"]?.some((binding) => binding.HostPort === "54322")) throw new Error("Unexpected local database port.");
  assertLoopbackPorts(ports);
  const gatewayPorts = JSON.parse(runQuiet("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", "supabase_kong_chagokchan"]));
  if (!gatewayPorts["8000/tcp"]?.some((binding) => binding.HostPort === "54321")) throw new Error("Unexpected local API port.");
  assertLoopbackPorts(gatewayPorts);
  const status = JSON.parse(supabaseCli(["status", "--output", "json"]));
  if (status.API_URL !== config.supabaseUrl) throw new Error("Unexpected local Auth endpoint.");
  return status;
}
export function sql(statement, variables = {}) {
  const args = ["exec", "-i", databaseContainer, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"];
  for (const [key, value] of Object.entries(variables)) {
    if (!/^[a-z_]+$/.test(key) || typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error("Invalid SQL setup variable.");
    args.push("-v", key + "=" + value);
  }
  return runQuiet("docker", [...args, "-f", "-"], { input: statement });
}
