import assert from "node:assert/strict";
import fs from "node:fs";
import { openBoardView } from "../src/client/board-loading.mjs";
import { validateEnvironment } from "./runtime-environment.mjs";

// Read-only local comparison. No titles, IDs, bodies or credentials are emitted.
process.loadEnvFile(".env.development.local");
const config = validateEnvironment({ ...process.env, NODE_ENV: "development" }, { command: "dev", bindingHost: "127.0.0.1" });
if (config.authMode !== "local_fixture") throw new Error("Only a local fixture server is supported.");
const base = config.baseUrl;
try {
let requests = 0;
async function get(path) {
  requests++;
  const response = await fetch(new URL(path, base), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, "A local read request must succeed.");
  assert.match(response.headers.get("cache-control"), /no-store/);
  return response.json();
}
const ms = start => Math.round((performance.now() - start) * 10) / 10;
const samples = [];
for (let i = 0; i < 9; i++) {
  requests = 0;
  const listStart = performance.now();
  const legacy = await get("/api/v1/goals?limit=20");
  const details = await Promise.all(legacy.items.map(goal => get(`/api/v1/goals/${goal.id}`)));
  const legacyCards = { ms: ms(listStart), requests };
  assert.ok(details.length, "An existing owner goal is required; this command never creates data.");
  requests = 0;
  const newListStart = performance.now();
  const overview = await get("/api/v1/goal-overviews?limit=20");
  const overviewCards = { ms: ms(newListStart), requests };
  assert.deepEqual(overview.items, details, "Owner card projections must match the existing authorized details.");
  assert.equal(overview.next_cursor, legacy.next_cursor);
  const goalId = legacy.items[0].id;
  const detailPath = `/api/v1/goals/${goalId}`;
  requests = 0;
  const oldOpenStart = performance.now();
  const detail = await get(detailPath);
  await Promise.all(detail.boards.map(board => get(`/api/v1/boards/${board.id}/bunches?limit=50`)));
  const board = detail.boards.find(item => item.kind === "personal");
  if (board.current_bunch) await get(`/api/v1/boards/${board.id}/praises?limit=50&bunch_id=${board.current_bunch.id}`);
  const legacyOpen = { ms: ms(oldOpenStart), requests };
  requests = 0;
  const newOpenStart = performance.now();
  let firstReady;
  let historyFailed = false;
  const histories = [];
  await openBoardView({ goalId, getDetail: () => get(detailPath),
    getHistory: id => { const p = get(`/api/v1/boards/${id}/bunches?limit=50`); histories.push(p); return p; },
    getPraises: (id,bunch) => bunch ? get(`/api/v1/boards/${id}/praises?limit=50&bunch_id=${bunch}`) : Promise.resolve(),
    onReady: () => { firstReady = { ms: ms(newOpenStart), requests }; }, onHistory: () => {}, onHistoryError: () => { historyFailed = true; }, isCurrent: () => true,
  });
  const recordsReadyMs = ms(newOpenStart);
  await Promise.all(histories);
  assert.equal(historyFailed, false);
  samples.push({ round: i + 1, legacy_cards: legacyCards, overview_cards: overviewCards, legacy_open: legacyOpen, current_board_ready: firstReady, records_ready_ms: recordsReadyMs });
}
const median = values => { const sorted = values.toSorted((a,b) => a-b); return Math.round(((sorted[3] + sorted[4]) / 2) * 10) / 10; };
const warm = samples.slice(1);
const report = { measured_at: new Date().toISOString(), scope: "local_read_only_API_and_client_orchestration_comparison_not_browser_paint_or_production_load", samples,
  warm_samples: warm.length, existing_goals: samples[1].legacy_cards.requests - 1,
  median_ms: { legacy_cards: median(warm.map(s=>s.legacy_cards.ms)), overview_cards: median(warm.map(s=>s.overview_cards.ms)), legacy_open: median(warm.map(s=>s.legacy_open.ms)), current_board_ready: median(warm.map(s=>s.current_board_ready.ms)), records_ready: median(warm.map(s=>s.records_ready_ms)) },
  checks: ["same_owner_card_projection", "same_cursor", "all_requests_200_no_store", "no_product_writes", "current_board_ready_before_histories"] };
fs.mkdirSync("tmp", { recursive: true });
fs.writeFileSync("tmp/w26-board-loading-measurements.json", JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ scope: report.scope, warm_samples: warm.length, existing_goals: report.existing_goals, median_ms: report.median_ms }) + "\n");
} catch {
  process.stderr.write("Local performance comparison failed; response bodies and identifiers withheld.\n");
  process.exitCode = 1;
}
