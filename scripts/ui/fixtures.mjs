import { expect } from "@playwright/test";

export const boardA = { viewer_role: "contributor", id: "11111111-1111-4111-8111-111111111111", kind: "shared", shared_title: "합성 공유판 A", shared_description: null, owner: { user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nickname: "합성 A", avatar_key: "star" }, goal_state: "active", can_praise: true, current_bunch: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", cycle_no: 1, target_count: 20, valid_count: 0, progress_state: "incomplete", completed_at: null } };
export const boardB = { ...boardA, id: "22222222-2222-4222-8222-222222222222", shared_title: "합성 공유판 B", owner: { ...boardA.owner, user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nickname: "합성 B" }, current_bunch: { ...boardA.current_bunch, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } };
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const fulfill = (route, body, status = 200) => route.fulfill({ status, json: body, headers: { "Cache-Control": "no-store" } });

export async function prepare(page, custom = async () => false) {
  const unexpected = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:3417");
    const path = url.pathname;
    if (await custom({ route, request, path })) return;
    if (path === "/api/v1/auth/csrf") return fulfill(route, { csrf_token: "synthetic-ui-csrf" });
    if (request.method() === "GET" && path === "/api/v1/me") return fulfill(route, { profile: { user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", nickname: "합성 사용자", avatar_key: "star" } });
    if (request.method() === "GET" && path === "/api/v1/shared-boards") return fulfill(route, { items: [boardA, boardB], next_cursor: null });
    for (const board of [boardA, boardB]) {
      if (request.method() !== "GET") break;
      if (path === `/api/v1/boards/${board.id}`) return fulfill(route, board);
      if (path === `/api/v1/boards/${board.id}/bunches`) return fulfill(route, { items: [board.current_bunch], next_cursor: null });
      if (path === `/api/v1/boards/${board.id}/praises`) return fulfill(route, { items: [], next_cursor: null });
    }
    const collections = ["goal-overviews", "notifications", "sent-praises", "connections", "connection-invites", "connection-requests", "blocks", "trash/goals"];
    if (request.method() === "GET" && collections.some(name => path === `/api/v1/${name}`)) return fulfill(route, { items: [], next_cursor: null });
    unexpected.push(`${request.method()} ${path}`);
    await route.abort("blockedbyclient");
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "받은 공유판", exact: true })).toBeVisible();
  return { check: () => { expect(unexpected).toEqual([]); expect(errors).toEqual([]); } };
}

export async function sharedWorkspace(page) {
  await page.getByRole("button", { name: "받은 공유판", exact: true }).click();
  await expect(page.locator(".shared-board-card")).toHaveCount(2);
}
export async function selectBoard(page, board) {
  await page.locator(".shared-board-card").filter({ hasText: board.shared_title }).click();
  await expect(page.getByRole("heading", { name: board.shared_title, exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toBeEnabled();
}
