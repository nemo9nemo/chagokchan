import assert from "node:assert/strict";
import test from "node:test";
import { warmDevelopmentRoutes } from "./dev-warmup.mjs";
const local = { APP_ENV: "local", APP_AUTH_MODE: "local_fixture", NODE_ENV: "development", APP_BASE_URL: "http://127.0.0.1:3000", SUPABASE_URL: "http://127.0.0.1:54321", CHAGOKCHAN_BIND_HOST: "127.0.0.1" };
test("warmup makes bounded same-origin GETs without user credentials, writes or caches", async () => {
  const calls = [];
  const id = "11111111-1111-4111-8111-111111111111";
  const result = await warmDevelopmentRoutes(local, { fetcher: async (url,init) => {
    calls.push({ url,init });
    if (url.pathname === "/api/v1/goal-overviews") return Response.json({ items: [{ goal: { id }, boards: [{ id },{ id }] }] });
    return new Response("ok");
  } });
  assert.equal(result.requests, 8);
  for (const { url,init } of calls) {
    assert.equal(url.origin, local.APP_BASE_URL);
    assert.equal(init.method, "GET"); assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined); assert.equal(init.headers, undefined);
  }
});
test("empty workspace warmup needs only three public/local reads", async () => {
  assert.equal((await warmDevelopmentRoutes(local, { fetcher: async url => url.pathname === "/api/v1/goal-overviews" ? Response.json({ items: [] }) : new Response("ok") })).requests, 3);
});
test("production, remote and unknown fixture modes never perform warmup requests", async () => {
  for (const values of [{ NODE_ENV: "production" }, { APP_AUTH_MODE: "supabase_session" }, { APP_BASE_URL: "https://external.example.invalid" }, { CHAGOKCHAN_BIND_HOST: "0.0.0.0" }]) {
    await assert.rejects(warmDevelopmentRoutes({ ...local, ...values }, { fetcher: () => { throw new Error("must not fetch"); } }));
  }
});
test("non-successful reads fail without logging upstream response bodies", async () => {
  await assert.rejects(warmDevelopmentRoutes(local, { fetcher: async () => new Response("private body", { status: 503 }) }), error => !error.message.includes("private body"));
});
