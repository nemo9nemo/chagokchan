import { expect, test } from "@playwright/test";
import { boardA, boardB, deferred, fulfill, prepare, sharedWorkspace, syntheticMe } from "./fixtures.mjs";

const dialog = page => page.getByRole("dialog", { name: "내 표시 이름 설정", exact: true });
const open = async page => { await page.getByRole("button", { name: "표시 이름 설정", exact: true }).click(); await expect(dialog(page)).toBeVisible(); };

test("profile saves only changed fields and the next opening uses the acknowledged values", async ({ page }) => {
  const calls = [];
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (path !== "/api/v1/me" || request.method() !== "PATCH") return false;
    const patch = request.postDataJSON(); calls.push(patch);
    await fulfill(route, { ...syntheticMe, profile: { ...syntheticMe.profile, nickname: patch.nickname ?? "새 표시 이름", avatar_key: patch.avatar_key ?? "star" } }); return true;
  });
  await open(page); await expect(dialog(page).getByRole("button", { name: "표시 이름 저장" })).toBeDisabled();
  await dialog(page).getByLabel("표시 이름", { exact: true }).fill("  새 표시 이름  ");
  await dialog(page).getByRole("button", { name: "표시 이름 저장" }).click();
  await expect(dialog(page)).toHaveCount(0); expect(calls).toEqual([{ nickname: "새 표시 이름" }]);
  await page.getByRole("button", { name: "연결 관리", exact: true }).click();
  await expect(page.locator(".profile-toolbar")).toContainText("새 표시 이름");
  await open(page); await expect(dialog(page).getByLabel("표시 이름", { exact: true })).toHaveValue("새 표시 이름");
  await dialog(page).getByLabel("아바타", { exact: true }).selectOption("leaf");
  await dialog(page).getByRole("button", { name: "표시 이름 저장" }).click();
  await expect(dialog(page)).toHaveCount(0); expect(calls[1]).toEqual({ avatar_key: "leaf" });
  await open(page); await expect(dialog(page).getByLabel("아바타", { exact: true })).toHaveValue("leaf"); fixture.check();
});

test("failed save keeps the draft and a deliberate retry can succeed", async ({ page }) => {
  const calls = [];
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (path !== "/api/v1/me" || request.method() !== "PATCH") return false;
    calls.push(request.postDataJSON());
    await fulfill(route, calls.length === 1 ? { error: { code: "DEPENDENCY_UNAVAILABLE", message: "합성 저장 실패" } } : { ...syntheticMe, profile: { ...syntheticMe.profile, ...calls[1] } }, calls.length === 1 ? 503 : 200); return true;
  });
  await open(page); await dialog(page).getByLabel("표시 이름", { exact: true }).fill("보존할 이름");
  await dialog(page).getByRole("button", { name: "표시 이름 저장" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("합성 저장 실패");
  await expect(dialog(page).getByLabel("표시 이름", { exact: true })).toHaveValue("보존할 이름");
  await dialog(page).getByRole("button", { name: "표시 이름 저장" }).click(); await expect(dialog(page)).toHaveCount(0);
  expect(calls).toEqual([{ nickname: "보존할 이름" }, { nickname: "보존할 이름" }]); fixture.check();
});

test("same tick submits write once and saving blocks escape and close", async ({ page }) => {
  const gate = deferred(); let calls = 0;
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (path !== "/api/v1/me" || request.method() !== "PATCH") return false;
    calls++; await gate.promise; await fulfill(route, { ...syntheticMe, profile: { ...syntheticMe.profile, nickname: "한 번 저장" } }); return true;
  });
  await open(page); await dialog(page).getByLabel("표시 이름", { exact: true }).fill("한 번 저장");
  await dialog(page).locator("form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await expect(dialog(page).getByRole("button", { name: "저장 중…" })).toBeDisabled();
  await expect(dialog(page).getByRole("button", { name: "닫기", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(dialog(page)).toBeVisible(); expect(calls).toBe(1);
  gate.resolve(); await expect(dialog(page)).toHaveCount(0); fixture.check();
});

test("invalid names cannot submit and NFC plus twenty emoji use codepoints", async ({ page }) => {
  const fixture = await prepare(page); await open(page);
  const input = dialog(page).getByLabel("표시 이름", { exact: true }), save = dialog(page).getByRole("button", { name: "표시 이름 저장" });
  for (const value of ["", "　", " ", "😀".repeat(21)]) { await input.fill(value); await expect(save).toBeDisabled(); }
  for (const value of ["😀".repeat(20), "가".repeat(20)]) { await input.fill(value); await expect(save).toBeEnabled(); }
  await page.keyboard.press("Escape"); await expect(dialog(page)).toHaveCount(0); fixture.check();
});

test("keyboard close restores focus and 320 pixel dialog has no horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const fixture = await prepare(page); const trigger = page.getByRole("button", { name: "표시 이름 설정", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter"); await expect(dialog(page)).toBeVisible();
  expect(await dialog(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  for (const input of await dialog(page).locator("input,select,button").all()) expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `tmp/profile-dialog-${testInfo.project.name}.png` });
  await page.keyboard.press("Escape"); await expect(dialog(page)).toHaveCount(0); await expect(trigger).toBeFocused(); fixture.check();
});

test("same names show separate suffixes and blocking targets the selected actual user", async ({ page }) => {
  const people = [boardA.owner, boardB.owner, { ...syntheticMe.profile, user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }].map(person => ({ ...person, nickname: "동일 이름" }));
  const calls = [];
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (path === "/api/v1/connections" && request.method() === "GET") { await fulfill(route, { items: people.map((person, index) => ({ id: `connection-${index}`, status: "active", generation: 1, other_user: person })), next_cursor: null }); return true; }
    if (path === "/api/v1/blocks" && request.method() === "POST") { calls.push(request.postDataJSON()); await fulfill(route, {}); return true; }
    return false;
  });
  await page.getByRole("button", { name: "연결 관리", exact: true }).click();
  const section = page.locator("section").filter({ has: page.locator("#connected-heading") }).last();
  for (const prefix of ["AAAA", "BBBB", "CCCC"]) await expect(section.locator("li").filter({ hasText: `${prefix}-${prefix}-${prefix}` })).toContainText("동일 이름");
  page.on("dialog", prompt => prompt.accept());
  await section.locator("li").filter({ hasText: "BBBB-BBBB-BBBB" }).getByRole("button", { name: "차단", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1); expect(calls).toEqual([{ user_id: people[1].user_id }]);
  await expect(page.locator("body")).not.toContainText(people[1].user_id); fixture.check();
});

test("shared boards with identical owner names retain their independent owner suffix", async ({ page }) => {
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (path !== "/api/v1/shared-boards" || request.method() !== "GET") return false;
    await fulfill(route, { items: [boardA, boardB].map(board => ({ ...board, owner: { ...board.owner, nickname: "동일 이름" } })), next_cursor: null }); return true;
  });
  await sharedWorkspace(page);
  await expect(page.locator(".shared-board-card").filter({ hasText: boardA.shared_title })).toContainText("AAAA-AAAA-AAAA");
  await expect(page.locator(".shared-board-card").filter({ hasText: boardB.shared_title })).toContainText("BBBB-BBBB-BBBB"); fixture.check();
});

test("same names in board permissions grant only the chosen UUID", async ({ page }) => {
  const goalId = "99999999-9999-4999-8999-999999999999", personalId = "88888888-8888-4888-8888-888888888888";
  const people = [boardA.owner, boardB.owner, { ...syntheticMe.profile, user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }].map(person => ({ ...person, nickname: "동일 이름" }));
  const boards = [{ viewer_role: "owner", id: personalId, goal_id: goalId, kind: "personal", revision: 1, next_target_count: 20, shared_title: null, shared_description: null, current_bunch: null }, { viewer_role: "owner", id: boardA.id, goal_id: goalId, kind: "shared", revision: 1, next_target_count: 20, shared_title: "합성 공유판", shared_description: null, current_bunch: null }];
  const detail = { goal: { id: goalId, title: "권한 확인용 합성 목표", private_description: null, status: "active", revision: 1, created_at: "2026-11-17T00:00:00Z", completed_at: null, archived_at: null }, boards };
  const calls = []; let granted = false;
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (path === "/api/v1/goal-overviews") { await fulfill(route, { items: [detail], next_cursor: null }); return true; }
    if (path === `/api/v1/goals/${goalId}`) { await fulfill(route, detail); return true; }
    if (request.method() === "GET" && [personalId, boardA.id].some(id => path === `/api/v1/boards/${id}/bunches` || path === `/api/v1/boards/${id}/praises`)) { await fulfill(route, { items: [], next_cursor: null }); return true; }
    if (path === "/api/v1/connections") { await fulfill(route, { items: people.map((person, index) => ({ id: `connection-${index}`, status: "active", generation: 1, other_user: person })), next_cursor: null }); return true; }
    if (path === `/api/v1/boards/${boardA.id}/members`) { await fulfill(route, { items: granted ? [{ user: people[1], role: "contributor", status: "active", connection_generation: 1 }] : [], next_cursor: null }); return true; }
    if (request.method() === "PUT" && path.startsWith(`/api/v1/boards/${boardA.id}/members/`)) { calls.push({ path, body: request.postDataJSON() }); granted = true; await fulfill(route, {}); return true; }
    return false;
  });
  await page.locator(".goal-card").filter({ hasText: detail.goal.title }).click();
  await page.getByRole("button", { name: "공유 켬", exact: true }).click();
  const chosen = page.locator(".member-list li").filter({ hasText: "BBBB-BBBB-BBBB" });
  await chosen.getByRole("button", { name: "공유 허용", exact: true }).click();
  await expect(chosen.getByRole("button", { name: "권한 회수", exact: true })).toBeEnabled();
  expect(calls).toEqual([{ path: `/api/v1/boards/${boardA.id}/members/${people[1].user_id}`, body: { role: "contributor" } }]);
  await expect(page.locator(".member-list li").filter({ hasText: "AAAA-AAAA-AAAA" }).getByRole("button", { name: "공유 허용", exact: true })).toBeEnabled(); fixture.check();
});

test("profile read failure offers recovery without blocking personal board browsing", async ({ page }) => {
  let recoveryReady = false;
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (path !== "/api/v1/me" || request.method() !== "GET") return false;
    await fulfill(route, recoveryReady ? syntheticMe : { error: { code: "DEPENDENCY_UNAVAILABLE", message: "합성 읽기 실패" } }, recoveryReady ? 200 : 503); return true;
  });
  await expect(page.getByRole("button", { name: "표시 이름 설정", exact: true })).toBeDisabled();
  recoveryReady = true;
  await page.getByRole("button", { name: "계정 정보 다시 불러오기", exact: true }).click();
  await open(page); await expect(dialog(page).getByLabel("표시 이름", { exact: true })).toHaveValue(syntheticMe.profile.nickname); fixture.check();
});
