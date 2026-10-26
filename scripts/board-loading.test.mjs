import assert from "node:assert/strict";
import test from "node:test";
import { openBoardView } from "../src/client/board-loading.mjs";

function deferred() { let resolve; let reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
const current = { id: "current", valid_count: 2 };
function fixture(overrides = {}) {
  const events = [];
  const options = { goalId: "goal", getDetail: async () => ({ goal: { id: "goal" }, boards: [{ id: "personal", kind: "personal", current_bunch: current }, { id: "shared", kind: "shared", current_bunch: null }] }),
    getHistory: async () => ({ items: [current], next_cursor: null }), getPraises: async () => ({ items: [] }),
    onReady: (_detail, board, bunch) => events.push(["ready", board.id, bunch?.id]),
    onHistory: (id) => events.push(["history", id]), onHistoryError: () => events.push(["history_error"]), isCurrent: () => true, ...overrides };
  return { options, events };
}
test("current board and praise request do not await slow histories", async () => {
  const history = deferred();
  let praisesStarted = false;
  const { options, events } = fixture({ getHistory: () => history.promise, getPraises: async () => { praisesStarted=true; return { items: [] }; } });
  const result = await openBoardView(options);
  assert.deepEqual(events, [["ready", "personal", "current"]]);
  assert.equal(praisesStarted, true);
  assert.equal(result.bunch, current);
  history.resolve({ items: [], next_cursor: null });
});
test("a failed unrelated history keeps the board and records usable", async () => {
  const { options, events } = fixture({ getHistory: async () => { throw new Error("unavailable"); } });
  assert.deepEqual((await openBoardView(options)).page, { items: [] });
  await Promise.resolve();
  assert.equal(events[0][0], "ready");
  assert.ok(events.some(([kind]) => kind === "history_error"));
});
test("past-cycle deep link paginates only its board before selecting that cycle", async () => {
  const calls = [];
  const old = { id: "old" };
  const { options, events } = fixture({ preferredBoardId: "personal", preferredBunchId: "old", getHistory: async (id,cursor) => {
    calls.push([id,cursor]); return id === "personal" && !cursor ? { items: [current], next_cursor: "next" } : { items: [old], next_cursor: null };
  } });
  assert.equal((await openBoardView(options)).bunch.id, "old");
  assert.deepEqual(calls.filter(([id]) => id === "personal"), [["personal",undefined],["personal","next"]]);
  assert.deepEqual(events[0], ["ready","personal","old"]);
});
test("stale goal response cannot render or start another praise request", async () => {
  const { options, events } = fixture({ isCurrent: () => false, getPraises: () => { throw new Error("stale request"); } });
  assert.equal(await openBoardView(options), undefined);
  assert.deepEqual(events, []);
});
test("late histories cannot overwrite a newly selected goal", async () => {
  const history = deferred(); let active=true;
  const { options, events } = fixture({ getHistory: () => history.promise, isCurrent: () => active });
  await openBoardView(options); active=false;
  history.resolve({ items: [], next_cursor: null }); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(events, [["ready","personal","current"]]);
});
test("empty board renders without manufacturing a cycle or praise", async () => {
  const { options, events } = fixture({ getDetail: async () => ({ boards: [{ id: "empty", kind: "personal", current_bunch: null }] }), getPraises: async (_id,bunch) => { assert.equal(bunch, ""); return undefined; } });
  assert.equal((await openBoardView(options)).bunch, null);
  assert.deepEqual(events[0], ["ready","empty",undefined]);
});
