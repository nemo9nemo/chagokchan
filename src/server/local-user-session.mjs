import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { validateEnvironment } from "../../scripts/runtime-environment.mjs";
import { assertFixtureIdentity, validateFixtureManifest } from "../../scripts/local-fixture-manifest.mjs";

let fixtureClientPromise;

function readFixtureManifest() {
  const file = process.env.APP_LOCAL_FIXTURE_MANIFEST;
  if (!file || !path.isAbsolute(file)) throw new Error("Local fixture setup is unavailable.");
  const details = fs.lstatSync(file);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error("Local fixture setup is unavailable.");
  const manifest = validateFixtureManifest(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!manifest.data_seeded_at || Object.values(manifest.actors).some((entry) => !entry.id)) {
    throw new Error("Local fixture setup is incomplete.");
  }
  return manifest;
}

function currentConfiguration() {
  const command = process.env.NODE_ENV === "development" ? "dev" : "start";
  const config = validateEnvironment(process.env, {
    command,
    bindingHost: process.env.CHAGOKCHAN_BIND_HOST,
  });
  if (config.authMode !== "local_fixture") return null;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY) throw new Error("Local Auth configuration is unavailable.");
  return config;
}

async function createFixtureClient() {
  const config = currentConfiguration();
  if (!config) return null;

  const manifest = readFixtureManifest();
  if (manifest.api_origin !== config.supabaseUrl) throw new Error("Local fixture origin does not match the configured database.");
  const actor = config.actor;
  const credential = manifest.actors[actor];
  const client = createClient(config.supabaseUrl, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: true, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: credential.email,
    password: credential.password,
  });
  if (error || !data.session || !data.user) throw new Error("Local Auth session could not be prepared.");
  const userId = assertFixtureIdentity(data.user, actor, credential);
  if (userId !== credential.id) throw new Error("Local Auth identity does not match the fixture.");

  const { data: verified, error: verificationError } = await client.auth.getUser(data.session.access_token);
  if (verificationError || !verified.user || assertFixtureIdentity(verified.user, actor, credential) !== userId) {
    throw new Error("Local Auth session could not be verified.");
  }
  return { client, actor, credential, userId };
}

async function getFixtureClient() {
  if (!fixtureClientPromise) fixtureClientPromise = createFixtureClient();
  try {
    const fixture = await fixtureClientPromise;
    if (!fixture) return null;
    const { data, error } = await fixture.client.auth.getUser();
    if (error || !data.user || assertFixtureIdentity(data.user, fixture.actor, fixture.credential) !== fixture.userId) {
      fixtureClientPromise = undefined;
      return null;
    }
    return fixture;
  } catch (error) {
    fixtureClientPromise = undefined;
    throw error;
  }
}

export function validateMeProjection(value, expectedUserId) {
  const keys = ["account_status", "adult_confirmed_at", "profile", "registration_policy_version", "timezone", "user_id"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== keys.join("|")) {
    throw new Error("The account response does not match its contract.");
  }
  const profile = value.profile;
  const profileKeys = ["avatar_key", "nickname", "user_id"];
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || Object.keys(profile).sort().join("|") !== profileKeys.join("|")) {
    throw new Error("The profile response does not match its contract.");
  }
  if (value.user_id !== expectedUserId || profile.user_id !== expectedUserId || value.account_status !== "active" ||
      typeof value.timezone !== "string" || typeof value.adult_confirmed_at !== "string" ||
      typeof value.registration_policy_version !== "string" ||
      !(profile.nickname === null || typeof profile.nickname === "string") ||
      !(profile.avatar_key === null || typeof profile.avatar_key === "string")) {
    throw new Error("The account response does not match its contract.");
  }
  return {
    user_id: value.user_id,
    profile: { user_id: profile.user_id, nickname: profile.nickname, avatar_key: profile.avatar_key },
    timezone: value.timezone,
    account_status: value.account_status,
    adult_confirmed_at: value.adult_confirmed_at,
    registration_policy_version: value.registration_policy_version,
  };
}

export async function readLocalMe() {
  const fixture = await getFixtureClient();
  if (!fixture) return null;
  const { data, error } = await fixture.client.rpc("get_me");
  if (error) throw Object.assign(new Error("Account lookup failed."), { databaseCode: error.code, databaseMessage: error.message });
  return validateMeProjection(data, fixture.userId);
}

export function resetLocalFixtureSessionForTests() {
  fixtureClientPromise = undefined;
}
