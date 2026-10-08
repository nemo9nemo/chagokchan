import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertLocalDatabase, projectRoot, runQuiet, sql } from "./local-database-tools.mjs";
import { assertFixtureIdentity, fixtureCredentialHash, validateFixtureManifest } from "./local-fixture-manifest.mjs";

let phase = "validate_local_database";
async function prepare() {
  const status = assertLocalDatabase();
  phase = "prepare_private_manifest";
  const directory = path.join(projectRoot, "private-data");
  const manifestPath = path.join(directory, "local-fixtures.json");
  if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || !fs.lstatSync(directory).isDirectory())) throw new Error("Invalid private data directory.");
  if (fs.existsSync(manifestPath) && fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error("Invalid fixture manifest path.");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let ownerSid;
  if (process.platform === "win32") {
    ownerSid = runQuiet("whoami", ["/user", "/fo", "csv", "/nh"]).match(/S-1-5-[0-9-]+/)?.[0];
    if (!ownerSid) throw new Error("Cannot restrict fixture credential access.");
    runQuiet("icacls", [directory, "/inheritance:r", "/grant:r", "*" + ownerSid + ":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"]);
  } else fs.chmodSync(directory, 0o700);
  const save = (manifest) => {
    validateFixtureManifest(manifest);
    const temporary = path.join(directory, "local-fixtures.next.json");
    if (fs.existsSync(temporary) && fs.lstatSync(temporary).isSymbolicLink()) throw new Error("Invalid fixture temporary path.");
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    if (ownerSid) runQuiet("icacls", [temporary, "/inheritance:r", "/grant:r", "*" + ownerSid + ":F", "*S-1-5-18:F"]);
    fs.renameSync(temporary, manifestPath);
  };
  const manifest = fs.existsSync(manifestPath) ? validateFixtureManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8"))) : {
    version: 1, mode: "local_fixture", api_origin: status.API_URL, data_seeded_at: null,
    actors: Object.fromEntries(["A", "B", "C"].map((actor) => [actor, { email: actor.toLowerCase() + "@fixture.chagokchan.invalid", password: crypto.randomBytes(32).toString("base64url"), id: null }])),
  };
  // Persist random credentials before creating accounts so interrupted setup can recover.
  save(manifest);
  const key = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!key) throw new Error("Local setup key unavailable.");
  const admin = createClient(status.API_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }) },
  });
  for (const actor of ["A", "B", "C"]) {
    phase = "verify_auth_fixture_" + actor;
    const entry = manifest.actors[actor];
    let user;
    if (entry.id) {
      const result = await admin.auth.admin.getUserById(entry.id);
      if (result.error) throw new Error("Fixture account no longer available; setup will not recreate it.");
      user = result.data.user;
    } else {
      // Recover only the marked synthetic account after an interrupted create.
      for (let page = 1; page <= 10; page += 1) {
        const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
        if (result.error) throw new Error("Fixture lookup failed.");
        user = result.data.users.find((candidate) => candidate.email === entry.email);
        if (user || result.data.users.length < 100) break;
        if (page === 10) throw new Error("Unexpected local account count.");
      }
      if (!user) {
        const result = await admin.auth.admin.createUser({
          email: entry.email, password: entry.password, email_confirm: true,
          app_metadata: { local_fixture: true, fixture_actor: actor, fixture_project: "chagokchan", fixture_credential_hash: fixtureCredentialHash(entry) },
        });
        if (result.error) throw new Error("Fixture creation failed; credentials retained for setup retry.");
        user = result.data.user;
      }
    }
    entry.id = assertFixtureIdentity(user, actor, entry);
    save(manifest);
  }
  const variables = Object.fromEntries(["A", "B", "C"].map((actor) => ["actor_" + actor.toLowerCase(), manifest.actors[actor].id]));
  phase = "check_deletion_state";
  const ids = Object.values(variables).map((id) => "'" + id + "'::uuid").join(",");
  if (sql("select exists(select 1 from public.app_users where id in (" + ids + ") and account_status <> 'active') or exists(select 1 from public.account_deletion_requests where subject_auth_user_id in (" + ids + ") and status in ('pending','running','failed'));\n").trim() !== "f") throw new Error("Fixture is being deleted; setup will not reactivate it.");
  if (manifest.data_seeded_at === null) {
    phase = "seed_app_data_once";
    const policy = JSON.parse(fs.readFileSync(path.join(projectRoot, "policies/app-policy.json"), "utf8"));
    variables.policy_version = policy.policy_version;
    sql(fs.readFileSync(path.join(projectRoot, "supabase/seeds/local-fixtures.sql"), "utf8"), variables);
    manifest.data_seeded_at = new Date().toISOString();
    save(manifest);
  }
  process.stdout.write(JSON.stringify({ status: "prepared", actors: ["A", "B", "C"], credentials: "private-data/local-fixtures.json (ignored)", human_login_tested: false, automatic_data_reset: false }) + "\n");
}
try { await prepare(); } catch {
  process.stderr.write("Local fixture setup failed at " + phase + ". Credentials are kept privately for inspection; accounts are not automatically restored.\n");
  process.exitCode = 1;
}
