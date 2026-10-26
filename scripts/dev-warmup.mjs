import { validateEnvironment } from "./runtime-environment.mjs";

export async function warmDevelopmentRoutes(env, { fetcher = fetch, signal } = {}) {
  const config = validateEnvironment(env, { command: "dev", bindingHost: env.CHAGOKCHAN_BIND_HOST });
  if (config.authMode !== "local_fixture") throw new Error("Warmup is local-only.");
  let requests = 0;
  async function get(path, json = false) {
    requests++;
    const response = await fetcher(new URL(path, config.baseUrl), {
      method: "GET", cache: "no-store", redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error("Local read-only warmup is unavailable.");
    return json ? response.json() : response.arrayBuffer();
  }
  const [, , page] = await Promise.all([get("/"), get("/api/v1/me"), get("/api/v1/goal-overviews?limit=1", true)]);
  const detail = page.items?.[0];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (detail && uuid.test(detail.goal?.id)) {
    await get(`/api/v1/goals/${detail.goal.id}`);
    await Promise.all((detail.boards ?? []).slice(0, 2).filter(board => uuid.test(board.id)).flatMap(board => [
      get(`/api/v1/boards/${board.id}/bunches?limit=1`),
      get(`/api/v1/boards/${board.id}/praises?limit=1`),
    ]));
  }
  return { requests };
}
