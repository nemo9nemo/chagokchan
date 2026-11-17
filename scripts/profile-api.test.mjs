import assert from "node:assert/strict";
import test from "node:test";
import { createCsrfToken } from "../src/server/api-security.mjs";
import { updateMeResponse, validateUpdateMeInput } from "../src/server/profile-api.mjs";
import { formatDisplayCode, normalizeNickname, profileDisplayCode } from "../src/shared/profile.mjs";

const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const origin = "https://profile.example.invalid", secret = "profile-test-only-csrf-signing-material";
const options = { expectedOrigin: origin, secret, env: { APP_AUTH_MODE: "local_fixture" } };
const me = { user_id: id, profile: { user_id: id, nickname: "내 이름", avatar_key: "star" }, timezone: "Asia/Seoul", account_status: "active", adult_confirmed_at: "2026-11-17T00:00:00Z", registration_policy_version: "0.2.0" };
function request(body, csrf = true) {
  const token = createCsrfToken(secret);
  return new Request(`${origin}/api/v1/me`, { method: "PATCH", headers: { origin, "content-type": "application/json", ...(csrf ? { cookie: `chagokchan_csrf=${token}`, "x-csrf-token": token } : {}) }, body: JSON.stringify(body) });
}

test("profile input normalizes NFC and ASCII edge spaces and changes only supplied fields", () => {
  assert.deepEqual(validateUpdateMeInput({ nickname: "  가  " }), { p_nickname: "가", p_avatar_key: null });
  assert.deepEqual(validateUpdateMeInput({ avatar_key: "leaf" }), { p_nickname: null, p_avatar_key: "leaf" });
  assert.equal(normalizeNickname("😀".repeat(20)), "😀".repeat(20));
  assert.equal(normalizeNickname("😀".repeat(21)), null);
});

test("profile input rejects empty, oversized, control-only, identity and unimplemented fields", () => {
  for (const body of [null, [], {}, { nickname: "" }, { nickname: "   " }, { nickname: "　" }, { nickname: "\tname" },
    { nickname: "a\u0000b" }, { nickname: "a\u0085b" }, { nickname: "\ud800" }, { nickname: "a".repeat(21) }, { nickname: null },
    { nickname: 1 }, { avatar_key: "external-avatar" }, { avatar_key: null }, { user_id: other, nickname: "name" },
    { nickname: "name", timezone: "UTC" }, { nickname: "name", adult_confirmed_at: "changed" }, { avatar_key: "star", account_status: "active" }]) {
    assert.throws(() => validateUpdateMeInput(body), error => error.status === 400);
  }
});

test("CSRF and invalid body stop profile RPC calls", async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: me }; } };
  assert.equal((await updateMeResponse(request({ nickname: "내 이름" }, false), client, id, options)).status, 403);
  assert.equal((await updateMeResponse(request({ user_id: other }), client, id, options)).status, 400);
  assert.equal(calls, 0);
});

test("profile update forwards no caller identity and returns only the verified actor Me", async () => {
  let captured;
  const client = { rpc: async (name, args) => { captured = { name, args }; return { data: me, error: null }; } };
  const response = await updateMeResponse(request({ nickname: "  내 이름  " }), client, id, options);
  assert.equal(response.status, 200);
  assert.deepEqual(captured, { name: "update_my_profile", args: { p_nickname: "내 이름", p_avatar_key: null } });
  assert.deepEqual(await response.json(), me); assert.match(response.headers.get("cache-control"), /no-store/);
});

test("expanded, foreign, malformed and unacknowledged profile results never claim success", async () => {
  for (const data of [{ ...me, user_id: other }, { ...me, profile: { ...me.profile, user_id: other } },
    { ...me, private_email: "do-not-return@example.invalid" }, { ...me, profile: { ...me.profile, nickname: "wrong name" } },
    { ...me, profile: { ...me.profile, avatar_key: "invalid" } }]) {
    const response = await updateMeResponse(request({ nickname: "내 이름" }), { rpc: async () => ({ data, error: null }) }, id, options);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /wrong name|private_email|do-not-return/);
  }
});

test("profile dependency/session/limit failures map to safe retry information", async () => {
  for (const [code, status] of [["PT400", 400], ["PT401", 401], ["PT403", 403], ["PT429", 429], ["PT503", 503], ["42501", 503]]) {
    const response = await updateMeResponse(request({ avatar_key: "leaf" }), { rpc: async () => ({ error: { code, message: "hidden database detail" } }) }, id, options);
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /hidden database detail/);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "60");
  }
});

test("profile disambiguation shows only a grouped display suffix and is not an identity input", () => {
  assert.equal(formatDisplayCode(profileDisplayCode(id)), "1111-1111-1111");
  assert.notEqual(profileDisplayCode(id), profileDisplayCode(other));
  assert.equal(profileDisplayCode("not-an-id"), null); assert.equal(formatDisplayCode("bad"), null);
  assert.doesNotMatch(formatDisplayCode(profileDisplayCode(id)), /4111|8111/);
});
