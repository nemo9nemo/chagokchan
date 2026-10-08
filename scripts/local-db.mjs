import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { openLoopbackDockerBridge, assertLoopbackPorts } from "./docker-loopback-proxy.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const action = process.argv[2];
if (!["init", "start", "status", "stop"].includes(action)) throw new Error("Use init, start, status or stop.");
const expectedNode = fs.readFileSync(path.join(root, ".node-version"), "utf8").trim();
if (process.versions.node !== expectedNode) throw new Error("Use Node " + expectedNode + ".");
const packageRoot = path.join(root, "node_modules", "supabase");
const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const binRelative = typeof metadata.bin === "string" ? metadata.bin : metadata.bin.supabase;
let executable = path.join(packageRoot, binRelative);
if (process.platform === "win32" && !executable.endsWith(".exe") && fs.existsSync(executable + ".exe")) executable += ".exe";
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error("Local DB command failed: " + command + " (" + (result.error?.code ?? result.status) + ")");
  return result.stdout;
};
const cli = (args, options = {}) => executable.endsWith(".js")
  ? run(process.execPath, [executable, ...args], options)
  : run(executable, args, options);
const cliAsync = (args, env) => new Promise((resolve, reject) => {
  const child = executable.endsWith(".js")
    ? spawn(process.execPath, [executable, ...args], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  // CLI output can include local credentials. Consume it without logging it.
  child.stdout.resume();
  child.stderr.resume();
  const timer = setTimeout(() => { child.kill(); reject(new Error("Local Supabase startup timed out")); }, 20 * 60 * 1000);
  child.once("error", (error) => { clearTimeout(timer); reject(error); });
  child.once("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("Local Supabase startup failed (" + code + ")")); });
});
if (action === "init") {
  if (!fs.existsSync(path.join(root, "supabase/config.toml"))) cli(["init", "--yes"], { timeout: 120000 });
  const configPath = path.join(root, "supabase/config.toml");
  let config = fs.readFileSync(configPath, "utf8");
  config = config.replace(/^project_id = .+$/m, 'project_id = "chagokchan"');
  config = config.replace(/^schemas = .+$/m, 'schemas = ["public"]');
  config = config.replace(/^max_rows = .+$/m, "max_rows = 100");
  config = config.replace(/^# auto_expose_new_tables = .+$/m, "auto_expose_new_tables = false");
  config = config.replace(/^jwt_expiry = .+$/m, "jwt_expiry = 900");
  config = config.replace(/(\[db\.seed\]\s*\n(?:#[^\n]*\n)*enabled = )true/m, "$1false");
  fs.writeFileSync(configPath, config, "utf8");
  process.stdout.write("Local Supabase configuration initialized.\n");
} else if (action === "start") {
  run("docker", ["version", "--format", "{{.Server.Version}}"]);
  const network = "chagokchan-local";
  const inspected = spawnSync("docker", ["network", "inspect", network], { cwd: root, encoding: "utf8", timeout: 15000, windowsHide: true });
  if (inspected.status !== 0) run("docker", ["network", "create", "-o", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1", network]);
  else if (JSON.parse(inspected.stdout)[0]?.Options?.["com.docker.network.bridge.host_binding_ipv4"] !== "127.0.0.1") throw new Error("Local Docker network must bind published ports to loopback.");
  const startArgs = ["start", "--network-id", network, "--exclude", "realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor"];
  if (process.platform === "win32") {
    const endpoint = run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"] ).trim();
    const bridge = await openLoopbackDockerBridge(endpoint);
    const cliEnv = { ...process.env, DOCKER_HOST: bridge.endpoint };
    delete cliEnv.DOCKER_CONTEXT;
    try { await cliAsync(startArgs, cliEnv); } finally { await bridge.close(); }
  } else cli(startArgs, { timeout: 20 * 60 * 1000 });
  try {
    const names = run("docker", ["ps", "--filter", "name=chagokchan", "--format", "{{.Names}}"] ).trim().split("\n").filter(Boolean);
    if (names.length < 5) throw new Error("Local Supabase services are missing");
    for (const name of names) {
      if (!/^supabase_[a-z0-9_]+_chagokchan$/.test(name)) throw new Error("Unexpected local service");
      const ports = JSON.parse(run("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", name]));
      assertLoopbackPorts(ports);
    }
  } catch (error) {
    cli(["stop"], { timeout: 120000 });
    throw error;
  }
  const status = JSON.parse(cli(["status", "--output", "json"]));
  const apiUrl = status.API_URL;
  if (apiUrl !== "http://127.0.0.1:54321") throw new Error("Unexpected local API address.");
  const envPath = path.join(root, ".env.development.local");
  let env = fs.readFileSync(envPath, "utf8");
  env = env.replace(/^SUPABASE_URL=.*$/m, "SUPABASE_URL=" + apiUrl);
  env = env.replace(/^SUPABASE_PUBLISHABLE_KEY=.*$/m, "SUPABASE_PUBLISHABLE_KEY=" + (status.PUBLISHABLE_KEY ?? status.ANON_KEY ?? ""));
  fs.writeFileSync(envPath, env, { encoding: "utf8", mode: 0o600 });
  process.stdout.write("Local Supabase started on loopback; app settings saved privately. No credentials displayed.\n");
} else if (action === "status") {
  const status = JSON.parse(cli(["status", "--output", "json"]));
  process.stdout.write(JSON.stringify({ api: status.API_URL, studio: status.STUDIO_URL, database_running: Boolean(status.DB_URL) }) + "\n");
} else {
  cli(["stop"], { timeout: 120000 });
  process.stdout.write("This project's local Supabase services stopped.\n");
}
