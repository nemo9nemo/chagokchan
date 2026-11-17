import { expect, test } from "@playwright/test";
import { boardA, boardB, deferred, fulfill, prepare, selectBoard, sharedWorkspace } from "./fixtures.mjs";

test("unsent drafts belong to their board and disappear on a fresh page", async ({ page }) => {
  const fixture = await prepare(page);
  await sharedWorkspace(page); await selectBoard(page, boardA);
  await page.getByRole("textbox", { name: "공유판에 보낼 칭찬" }).fill("A에게만 남긴 합성 초안");
  await selectBoard(page, boardB);
  await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("");
  await page.getByRole("textbox", { name: "공유판에 보낼 칭찬" }).fill("B의 별도 합성 초안");
  await selectBoard(page, boardA);
  await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("A에게만 남긴 합성 초안");
  await page.getByRole("button", { name: "내 판", exact: true }).click();
  await sharedWorkspace(page); await selectBoard(page, boardB);
  await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("B의 별도 합성 초안");
  await page.reload(); await sharedWorkspace(page); await selectBoard(page, boardA);
  await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("");
  fixture.check();
});

for (const failure of ["unreached", "lost-response", "429", "503"]) {
  test(`${failure}: A retry keeps its target, body and key while B has an independent submission`, async ({ page }) => {
    const calls = [], receipts = new Map(); let created = 0;
    const fixture = await prepare(page, async ({ route, request, path }) => {
      if (request.method() !== "POST" || !path.endsWith("/praises")) return false;
      const call = { path, body: request.postDataJSON(), key: request.headers()["idempotency-key"] }; calls.push(call);
      const board = path.includes(boardA.id) ? boardA : boardB;
      if (calls.length === 1) {
        if (failure === "lost-response") { created++; receipts.set(call.key, board.id); }
        if (failure === "unreached" || failure === "lost-response") await route.abort("failed");
        else await fulfill(route, { error: { code: "DEPENDENCY_UNAVAILABLE", message: "합성 응답 오류" } }, Number(failure));
        return true;
      }
      const replayed = receipts.has(call.key);
      if (replayed) expect(receipts.get(call.key)).toBe(board.id);
      else { created++; receipts.set(call.key, board.id); }
      await fulfill(route, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", bunch_id: board.current_bunch.id, replayed }); return true;
    });
    await sharedWorkspace(page); await selectBoard(page, boardA);
    await page.getByRole("textbox", { name: "공유판에 보낼 칭찬" }).fill("A에게 보내는 합성 응원");
    await page.getByRole("button", { name: "칭찬 보내기", exact: true }).click();
    await expect(page.getByRole("button", { name: "같은 칭찬 다시 확인", exact: true })).toBeEnabled();
    await selectBoard(page, boardB);
    await page.getByRole("textbox", { name: "공유판에 보낼 칭찬" }).fill("B에게 보내는 별도 응원");
    await page.getByRole("button", { name: "칭찬 보내기", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("");
    await page.locator(".shared-board-card").filter({ hasText: boardA.shared_title }).click();
    await expect(page.getByRole("button", { name: "같은 칭찬 다시 확인", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "같은 칭찬 다시 확인", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("");
    expect(calls).toHaveLength(3); expect(calls[2]).toEqual(calls[0]);
    expect(calls[1].path).toContain(boardB.id); expect(calls[1].key).not.toBe(calls[0].key); expect(created).toBe(2);
    fixture.check();
  });
}

test("in-flight submission blocks board navigation and repeated form events", async ({ page }) => {
  const entered = deferred(), release = deferred(); let writes = 0;
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (request.method() !== "POST" || !path.endsWith("/praises")) return false;
    writes++; entered.resolve(); await release.promise;
    await fulfill(route, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", bunch_id: boardA.current_bunch.id, replayed: false }); return true;
  });
  await sharedWorkspace(page); await selectBoard(page, boardA);
  await page.getByRole("textbox", { name: "공유판에 보낼 칭찬" }).fill("합성 단일 전송");
  await page.locator(".praise-composer form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await entered.promise;
  await expect(page.locator(".shared-board-card").filter({ hasText: boardB.shared_title })).toBeDisabled();
  await expect(page.getByRole("button", { name: "내 판", exact: true })).toBeDisabled();
  expect(writes).toBe(1); release.resolve();
  await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("");
  expect(writes).toBe(1); fixture.check();
});

for (const destination of ["B", "goals"]) {
  test(`a late A board read cannot overwrite ${destination}`, async ({ page }) => {
    const entered = deferred(), release = deferred(), completed = deferred();
    const fixture = await prepare(page, async ({ route, path }) => {
      if (path !== `/api/v1/boards/${boardA.id}`) return false;
      entered.resolve(); await release.promise; await fulfill(route, boardA); completed.resolve(); return true;
    });
    await sharedWorkspace(page);
    await page.locator(".shared-board-card").filter({ hasText: boardA.shared_title }).click(); await entered.promise;
    if (destination === "B") await selectBoard(page, boardB);
    else await page.getByRole("button", { name: "내 판", exact: true }).click();
    release.resolve(); await completed.promise;
    if (destination === "B") { await expect(page.getByRole("heading", { name: boardB.shared_title, exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: boardA.shared_title, exact: true })).toHaveCount(0); }
    else await expect(page.getByRole("button", { name: "내 판", exact: true })).toHaveAttribute("aria-current", "page");
    fixture.check();
  });
}

test("a late success refresh cannot reopen A over a newly selected B", async ({ page }) => {
  const entered = deferred(), release = deferred(), completed = deferred(); let saved = false;
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (request.method() === "POST" && path.endsWith("/praises")) {
      saved = true;
      await fulfill(route, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", bunch_id: boardA.current_bunch.id, replayed: false }); return true;
    }
    if (path !== "/api/v1/shared-boards" || !saved) return false;
    entered.resolve(); await release.promise; await fulfill(route, { items: [boardA, boardB], next_cursor: null }); completed.resolve(); return true;
  });
  await sharedWorkspace(page); await selectBoard(page, boardA);
  await page.getByRole("textbox", { name: "공유판에 보낼 칭찬" }).fill("합성 응원");
  await page.getByRole("button", { name: "칭찬 보내기", exact: true }).click(); await entered.promise;
  await selectBoard(page, boardB); release.resolve(); await completed.promise;
  await expect(page.getByRole("heading", { name: boardB.shared_title, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: boardA.shared_title, exact: true })).toHaveCount(0);
  fixture.check();
});

test("revoked A access preserves the error and never transfers its failed attempt to B", async ({ page }) => {
  let revoked = false, writes = 0;
  const fixture = await prepare(page, async ({ route, request, path }) => {
    if (request.method() === "POST" && path.endsWith("/praises")) {
      writes++; revoked = true; await fulfill(route, { error: { code: "DEPENDENCY_UNAVAILABLE", message: "합성 장애" } }, 503); return true;
    }
    if (revoked && path === `/api/v1/boards/${boardA.id}`) {
      await fulfill(route, { error: { code: "OBJECT_NOT_AVAILABLE", message: "공유 권한이 끝났어요." } }, 404); return true;
    }
    return false;
  });
  await sharedWorkspace(page); await selectBoard(page, boardA);
  await page.getByRole("textbox", { name: "공유판에 보낼 칭찬" }).fill("공유 권한이 끝나기 전 합성 초안");
  await page.getByRole("button", { name: "칭찬 보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 칭찬 다시 확인", exact: true })).toBeEnabled();
  await selectBoard(page, boardB);
  await page.locator(".shared-board-card").filter({ hasText: boardA.shared_title }).click();
  await expect(page.locator(".shared-board-center").getByRole("alert")).toContainText("공유 권한이 끝났어요.");
  await selectBoard(page, boardB);
  await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("");
  expect(writes).toBe(1); fixture.check();
});

for (const status of [403, 404, 409]) {
  test(`${status} is a definitive rejection and permits correcting the draft`, async ({ page }) => {
    const fixture = await prepare(page, async ({ route, request, path }) => {
      if (request.method() !== "POST" || !path.endsWith("/praises")) return false;
      await fulfill(route, { error: { code: "STATE_CONFLICT", message: "합성 확정 거절" } }, status); return true;
    });
    await sharedWorkspace(page); await selectBoard(page, boardA);
    await page.getByRole("textbox", { name: "공유판에 보낼 칭찬" }).fill("합성 거절 확인");
    await page.getByRole("button", { name: "칭찬 보내기", exact: true }).click();
    await expect(page.locator(".shared-board-center").getByRole("alert")).toContainText("합성 확정 거절");
    await expect(page.getByRole("button", { name: "같은 칭찬 다시 확인", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "공유판에 보낼 칭찬" })).toHaveValue("합성 거절 확인");
    fixture.check();
  });
}
