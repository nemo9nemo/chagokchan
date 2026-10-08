import assert from "node:assert/strict";
import test from "node:test";
import { classifyMutationOutcome, createIdempotentRequest } from "../src/client/idempotent-request.mjs";

test("a retry reuses the original key and an unchanged payload snapshot", () => {
  const original = { message: "오늘 산책했다", occurred_on: "2026-10-08" };
  const first = createIdempotentRequest(original, null, () => "stable-key");
  original.message = "화면에서 바뀐 값";
  const retry = createIdempotentRequest({ message: "다른 값" }, first, () => "unused-key");

  assert.equal(retry.key, "stable-key");
  assert.deepEqual(retry.body, { message: "오늘 산책했다", occurred_on: "2026-10-08" });
  assert.strictEqual(retry, first);
});

test("a new independent submission receives a new key and snapshot", () => {
  const next = createIdempotentRequest({ message: null, occurred_on: null }, null, () => "new-key");

  assert.deepEqual(next, { key: "new-key", body: { message: null, occurred_on: null } });
});

test("only a confirmed success clears the submission attempt", () => {
  assert.equal(classifyMutationOutcome(201, true), "succeeded");
  assert.equal(classifyMutationOutcome(503), "retry_same_key");
  assert.equal(classifyMutationOutcome(429), "retry_same_key");
  assert.equal(classifyMutationOutcome(409), "rejected");
  assert.equal(classifyMutationOutcome(400), "rejected");
});
