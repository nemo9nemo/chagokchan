import crypto from "node:crypto";
const actors = ["A", "B", "C"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validateFixtureManifest(manifest) {
  if (manifest?.version !== 1 || manifest.mode !== "local_fixture" || manifest.api_origin !== "http://127.0.0.1:54321") throw new Error("Invalid local fixture manifest.");
  if (!manifest.actors || Object.keys(manifest.actors).sort().join() !== actors.join()) throw new Error("Unexpected fixture actor list.");
  for (const actor of actors) {
    const entry = manifest.actors[actor];
    if (entry.email !== actor.toLowerCase() + "@fixture.chagokchan.invalid" || !/^[A-Za-z0-9_-]{43,}$/.test(entry.password)) throw new Error("Invalid fixture credential format.");
    if (entry.id !== null && !uuid.test(entry.id)) throw new Error("Invalid fixture identity.");
    if (Object.keys(entry).some((key) => !["email", "password", "id"].includes(key))) throw new Error("Unexpected fixture credential fields.");
  }
  if (manifest.data_seeded_at !== null && (!Number.isFinite(Date.parse(manifest.data_seeded_at)) || actors.some((actor) => manifest.actors[actor].id === null))) throw new Error("Incomplete fixture setup state.");
  if (Object.keys(manifest).some((key) => !["version", "mode", "api_origin", "actors", "data_seeded_at"].includes(key))) throw new Error("Unexpected fixture manifest fields.");
  return manifest;
}
export function assertFixtureIdentity(user, actor, entry) {
  if (!user || (entry.id !== null && user.id !== entry.id) || !uuid.test(user.id) || user.email !== entry.email || user.app_metadata?.fixture_project !== "chagokchan" || user.app_metadata?.fixture_actor !== actor || user.app_metadata?.local_fixture !== true || user.app_metadata?.fixture_credential_hash !== fixtureCredentialHash(entry)) throw new Error("Fixture identity does not match; inspect setup without restoring the account.");
  return user.id;
}
export function fixtureCredentialHash(entry) {
  return crypto.createHash("sha256").update(entry.password).digest("hex");
}
