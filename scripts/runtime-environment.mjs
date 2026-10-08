import fs from "node:fs";
const policy = JSON.parse(fs.readFileSync(new URL("../policies/development-policy.json", import.meta.url), "utf8"));
export class ConfigurationError extends Error {}
const fail = (name) => { throw new ConfigurationError(`Invalid configuration: ${name}`); };
const localHost = (host) => policy.local_guard.allowed_hosts.includes(host.replace(/^\[|\]$/g, ""));
function parseAddress(env, name) {
  let url;
  try { url = new URL(env[name]); } catch { fail(name); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") fail(name);
  return url;
}
export function validateEnvironment(env, { command, bindingHost } = {}) {
  const appEnv = env.APP_ENV;
  const mode = env.APP_AUTH_MODE;
  if (!["local", ...policy.deployed_auth.allowed_app_envs].includes(appEnv)) fail("APP_ENV");
  if (![policy.local_auth.mode, policy.deployed_auth.mode].includes(mode)) fail("APP_AUTH_MODE");
  const base = parseAddress(env, "APP_BASE_URL");
  const database = parseAddress(env, "SUPABASE_URL");
  if (mode === policy.local_auth.mode) {
    if (appEnv !== "local" || env.NODE_ENV !== "development" || command !== "dev") fail("local fixture execution");
    if (!localHost(bindingHost ?? "")) fail("binding host");
    if (!localHost(base.hostname) || base.protocol !== "http:") fail("APP_BASE_URL");
    if (!localHost(database.hostname) || database.protocol !== "http:" ||
        !policy.local_guard.allowed_supabase_ports.includes(Number(database.port))) fail("SUPABASE_URL");
    const actor = env.LOCAL_DEV_ACTOR ?? policy.local_auth.default_actor;
    if (!policy.local_auth.allowed_actors.includes(actor)) fail("LOCAL_DEV_ACTOR");
    return Object.freeze({ appEnv, authMode: mode, baseUrl: base.origin, supabaseUrl: database.origin, actor });
  }
  if (!policy.deployed_auth.allowed_app_envs.includes(appEnv) || env.NODE_ENV !== "production") fail("deployed execution");
  if (Object.keys(env).some((key) => (key.startsWith("LOCAL_DEV_") || key === "APP_LOCAL_FIXTURE_MANIFEST") && env[key])) fail("local fixture settings in deployed environment");
  for (const [name, url] of [["APP_BASE_URL", base], ["SUPABASE_URL", database]]) {
    if (localHost(url.hostname) || url.protocol !== "https:") fail(name);
  }
  return Object.freeze({ appEnv, authMode: mode, baseUrl: base.origin, supabaseUrl: database.origin });
}
