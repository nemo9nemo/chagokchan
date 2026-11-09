import fs from "node:fs";

export const PINNED_NODE_VERSION = fs.readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();

// Local/CI commands stay reproducible. Managed production platforms may roll
// forward security patches, but must never run an older or different major.
export function validateNodeVersion(version, { deployed = false } = {}) {
  const actual = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  const minimum = PINNED_NODE_VERSION.split(".").map(Number);
  const valid = actual && Number(actual[1]) === minimum[0] &&
    (Number(actual[2]) > minimum[1] || (Number(actual[2]) === minimum[1] && Number(actual[3]) >= minimum[2]));
  if (deployed ? !valid : version !== PINNED_NODE_VERSION) {
    throw new Error(deployed ? `Node >=${PINNED_NODE_VERSION} <${minimum[0] + 1} is required.` : `Node ${PINNED_NODE_VERSION} is required. Use scripts/project.ps1 or your Node version manager.`);
  }
}

export function serverBinding(command, env, config) {
  const local = command === "dev";
  const host = env.APP_BIND_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host) || (local && host !== "127.0.0.1")) {
    throw new Error("Invalid configuration: APP_BIND_HOST");
  }
  if (!local && (config.authMode !== "supabase_session" || !["preview", "staging", "production"].includes(config.appEnv))) {
    throw new Error("Invalid configuration: deployed binding");
  }
  const value = local ? new URL(config.baseUrl).port || "80" : env.PORT ?? "3000";
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) {
    throw new Error("Invalid configuration: PORT");
  }
  return { host, port: value };
}
