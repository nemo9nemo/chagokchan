import assert from "node:assert/strict";
import test from "node:test";
import { validateMeProjection } from "../src/server/local-user-session.mjs";

const uuidA = "11111111-1111-4111-8111-111111111111";
const me = () => ({
  user_id: uuidA,
  profile: { user_id: uuidA, nickname: "A", avatar_key: "seedling" },
  timezone: "Asia/Seoul",
  account_status: "active",
  adult_confirmed_at: "2026-10-08T00:00:00Z",
  registration_policy_version: "0.2.0",
});

test("get_me projection preserves the exact self-only contract", () => {
  assert.deepEqual(validateMeProjection(me(), uuidA), me());
});

test("get_me projection rejects an unexpected response field", () => {
  assert.throws(() => validateMeProjection({ ...me(), email: "private@example.invalid" }, uuidA));
});

test("get_me projection rejects another user's identity", () => {
  const otherId = "22222222-2222-4222-8222-222222222222";
  assert.throws(() => validateMeProjection(me(), otherId));
});

test("get_me projection rejects a non-active account", () => {
  assert.throws(() => validateMeProjection({ ...me(), account_status: "deleting" }, uuidA));
});
