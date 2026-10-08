import test from "node:test";
import assert from "node:assert/strict";
import { assertFixtureIdentity, fixtureCredentialHash, validateFixtureManifest } from "./local-fixture-manifest.mjs";
const fixture = () => ({ version: 1, mode: "local_fixture", api_origin: "http://127.0.0.1:54321", data_seeded_at: null, actors: Object.fromEntries(["A", "B", "C"].map((actor) => [actor, { email: actor.toLowerCase() + "@fixture.chagokchan.invalid", password: "a".repeat(43), id: null }])) });
test("setup manifest accepts an interrupted setup without assuming completed data", () => {
  const manifest = fixture();
  manifest.actors.A.id = "11111111-1111-4111-8111-111111111111";
  assert.equal(validateFixtureManifest(manifest).data_seeded_at, null);
});
test("credentials cannot be pointed at a hosted origin or real mailbox", () => {
  const remote = fixture(); remote.api_origin = "https://example.supabase.co";
  assert.throws(() => validateFixtureManifest(remote));
  const mailbox = fixture(); mailbox.actors.A.email = "person@example.com";
  assert.throws(() => validateFixtureManifest(mailbox));
});
test("unknown actors and persisted session tokens are rejected", () => {
  const unknown = fixture(); unknown.actors.D = unknown.actors.A;
  assert.throws(() => validateFixtureManifest(unknown));
  const token = fixture(); token.actors.A.access_token = "unexpected";
  assert.throws(() => validateFixtureManifest(token));
});
test("completed setup requires every Auth identity", () => {
  const incomplete = fixture(); incomplete.data_seeded_at = "2026-10-08T01:00:00Z";
  assert.throws(() => validateFixtureManifest(incomplete));
});
test("recovery cannot take over an unmarked or replaced account", () => {
  const entry = fixture().actors.A;
  const user = { id: "11111111-1111-4111-8111-111111111111", email: entry.email, app_metadata: { local_fixture: true, fixture_project: "chagokchan", fixture_actor: "A", fixture_credential_hash: fixtureCredentialHash(entry) } };
  assert.equal(assertFixtureIdentity(user, "A", entry), user.id);
  assert.throws(() => assertFixtureIdentity({ ...user, app_metadata: {} }, "A", entry));
  assert.throws(() => assertFixtureIdentity(user, "A", { ...entry, id: "22222222-2222-4222-8222-222222222222" }));
  assert.throws(() => assertFixtureIdentity(user, "A", { ...entry, password: "b".repeat(43) }));
});
