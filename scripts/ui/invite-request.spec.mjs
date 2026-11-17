import { expect, test } from "@playwright/test";
import { deferred, fulfill, prepare } from "./fixtures.mjs";

const codeA = "AAAAAAAAAAAAAAAA", codeB = "BBBBBBBBBBBBBBBB", tokenA = "a".repeat(32);
const expires = "2030-01-01T00:00:00Z";
const panel = page => page.locator(".connection-center");
const codeInput = page => page.getByRole("textbox", { name: "받은 초대 코드" });
async function previewCode(page, code = codeA) {
  await page.getByRole("button", { name: "연결 관리", exact: true }).click();
  await codeInput(page).fill(code);
  await page.getByRole("button", { name: "초대 확인", exact: true }).click();
  await expect(panel(page).locator(".invite-preview")).toContainText(code === codeA ? "합성 A" : "합성 B");
}
async function previewResponse({ route, request, path }) {
  if (path !== "/api/v1/connection-invites/preview") return false;
  const body = request.postDataJSON();
  await fulfill(route, { inviter_nickname: body.code === codeB ? "합성 B" : "합성 A", expires_at: expires }); return true;
}

for (const flow of ["code", "link"]) {
  for (const failure of ["unreached", "lost-response", "429", "503"]) {
    test(`${flow}/${failure}: retry is enabled and preserves the confirmed invite and key`, async ({ page }) => {
      const calls = []; const receipts = new Set(); let created = 0;
      const fixture = await prepare(page, async args => {
        if (await previewResponse(args)) return true;
        const { route, request, path } = args;
        if (path !== "/api/v1/connection-requests" || request.method() !== "POST") return false;
        const call = { body: request.postDataJSON(), key: request.headers()["idempotency-key"] }; calls.push(call);
        if (calls.length === 1) {
          if (failure === "lost-response") { created++; receipts.add(call.key); }
          if (failure === "unreached" || failure === "lost-response") await route.abort("failed");
          else await fulfill(route, { error: { code: "DEPENDENCY_UNAVAILABLE", message: "합성 요청 오류" } }, Number(failure));
        } else {
          if (!receipts.has(call.key)) { created++; receipts.add(call.key); }
          await fulfill(route, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", status: "pending" });
        }
        return true;
      }, flow === "link" ? `/#invite=${tokenA}` : "/");
      if (flow === "code") await previewCode(page);
      else { await expect(panel(page).locator(".invite-preview")).toContainText("합성 A"); await expect(page).not.toHaveURL(/#invite=/); }
      await page.getByRole("button", { name: "연결 요청 보내기", exact: true }).click();
      await expect(page.getByRole("button", { name: "같은 요청 다시 보내기", exact: true })).toBeEnabled();
      await expect(codeInput(page)).toBeDisabled();
      await expect(page.getByRole("button", { name: "초대 확인", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "같은 요청 다시 보내기", exact: true }).click();
      await expect(panel(page).locator(".invite-preview")).toHaveCount(0);
      expect(calls).toHaveLength(2); expect(calls[1]).toEqual(calls[0]);
      expect(calls[0].body).toEqual(flow === "code" ? { code: codeA } : { link_token: tokenA }); expect(created).toBe(1);
      await expect(codeInput(page)).toBeEnabled(); fixture.check();
    });
  }
}

test("changing a code invalidates the previous preview before a request can be sent", async ({ page }) => {
  const calls = [];
  const fixture = await prepare(page, async args => {
    if (await previewResponse(args)) return true;
    if (args.path !== "/api/v1/connection-requests" || args.request.method() !== "POST") return false;
    calls.push(args.request.postDataJSON()); await fulfill(args.route, { status: "pending" }); return true;
  });
  await previewCode(page);
  await codeInput(page).fill(codeB);
  await expect(panel(page).locator(".invite-preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "연결 요청 보내기", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "초대 확인", exact: true }).click();
  await expect(panel(page).locator(".invite-preview")).toContainText("합성 B");
  await page.getByRole("button", { name: "연결 요청 보내기", exact: true }).click();
  await expect(panel(page).locator(".invite-preview")).toHaveCount(0);
  expect(calls).toEqual([{ code: codeB }]); fixture.check();
});

test("duplicate form events cannot send twice and in-flight code/cancel/navigation are blocked", async ({ page }) => {
  const entered = deferred(), release = deferred(); let writes = 0;
  const fixture = await prepare(page, async args => {
    if (await previewResponse(args)) return true;
    if (args.path !== "/api/v1/connection-requests" || args.request.method() !== "POST") return false;
    writes++; entered.resolve(); await release.promise; await fulfill(args.route, { status: "pending" }); return true;
  });
  await previewCode(page);
  await panel(page).locator("form.invite-preview").evaluate(form => { form.requestSubmit(); form.requestSubmit(); }); await entered.promise;
  expect(writes).toBe(1);
  await expect(codeInput(page)).toBeDisabled(); await expect(page.getByRole("button", { name: "취소", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "내 판", exact: true })).toBeDisabled();
  release.resolve(); await expect(panel(page).locator(".invite-preview")).toHaveCount(0); expect(writes).toBe(1); fixture.check();
});

test("closing an uncertain request needs acknowledgement and never invokes withdrawal", async ({ page }) => {
  const calls = [];
  const fixture = await prepare(page, async args => {
    if (await previewResponse(args)) return true;
    if (args.path !== "/api/v1/connection-requests" || args.request.method() !== "POST") return false;
    calls.push({ body: args.request.postDataJSON(), key: args.request.headers()["idempotency-key"] });
    if (calls.length === 1) await args.route.abort("failed"); else await fulfill(args.route, { status: "pending" }); return true;
  });
  await previewCode(page); await page.getByRole("button", { name: "연결 요청 보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 다시 보내기", exact: true })).toBeEnabled();
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("철회되지 않아요"); await dialog.dismiss(); });
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 다시 보내기", exact: true })).toBeEnabled();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(panel(page).locator(".invite-preview")).toHaveCount(0); await expect(codeInput(page)).toHaveValue("");
  await codeInput(page).fill(codeB); await page.getByRole("button", { name: "초대 확인", exact: true }).click();
  await expect(panel(page).locator(".invite-preview")).toContainText("합성 B");
  await page.getByRole("button", { name: "연결 요청 보내기", exact: true }).click();
  await expect(panel(page).locator(".invite-preview")).toHaveCount(0);
  expect(calls).toHaveLength(2); expect(calls[1].body).toEqual({ code: codeB }); expect(calls[1].key).not.toBe(calls[0].key); fixture.check();
});

test("a delayed A preview cannot replace the newer B preview", async ({ page }) => {
  const entered = deferred(), release = deferred(), completed = deferred(), enteredB = deferred(), releaseB = deferred();
  const fixture = await prepare(page, async args => {
    if (args.path !== "/api/v1/connection-invites/preview") return false;
    if (args.request.postDataJSON().code === codeA) { entered.resolve(); await release.promise; await fulfill(args.route, { inviter_nickname: "합성 A", expires_at: expires }); completed.resolve(); return true; }
    enteredB.resolve(); await releaseB.promise; return previewResponse(args);
  });
  await page.getByRole("button", { name: "연결 관리", exact: true }).click();
  await codeInput(page).fill(codeA); await page.getByRole("button", { name: "초대 확인", exact: true }).click(); await entered.promise;
  await codeInput(page).fill(codeB); await page.getByRole("button", { name: "초대 확인", exact: true }).click();
  release.resolve(); await completed.promise; await enteredB.promise;
  await expect(panel(page).locator(".invite-preview")).toHaveCount(0);
  releaseB.resolve(); await expect(panel(page).locator(".invite-preview")).toContainText("합성 B"); fixture.check();
});

test("a successful outgoing request preserves the separately created invitation secret", async ({ page }) => {
  const fixture = await prepare(page, async args => {
    if (await previewResponse(args)) return true;
    if (args.request.method() !== "POST") return false;
    if (args.path === "/api/v1/connection-invites") { await fulfill(args.route, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", link_path: `/#invite=${tokenA}`, code: codeA, expires_at: expires }); return true; }
    if (args.path === "/api/v1/connection-requests") { await fulfill(args.route, { status: "pending" }); return true; }
    return false;
  });
  await page.getByRole("button", { name: "연결 관리", exact: true }).click();
  await page.getByRole("button", { name: "초대 만들기", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "초대 링크", exact: true })).toBeVisible();
  await codeInput(page).fill(codeB); await page.getByRole("button", { name: "초대 확인", exact: true }).click();
  await page.getByRole("button", { name: "연결 요청 보내기", exact: true }).click();
  await expect(panel(page).locator(".invite-preview")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "초대 링크", exact: true })).toHaveValue(`http://127.0.0.1:3417/#invite=${tokenA}`); fixture.check();
});

test("a definitive invite rejection unlocks editing without retaining a retry attempt", async ({ page }) => {
  const fixture = await prepare(page, async args => {
    if (await previewResponse(args)) return true;
    if (args.path !== "/api/v1/connection-requests" || args.request.method() !== "POST") return false;
    await fulfill(args.route, { error: { code: "OBJECT_NOT_AVAILABLE", message: "초대 사용 기한이 끝났어요." } }, 404); return true;
  });
  await previewCode(page); await page.getByRole("button", { name: "연결 요청 보내기", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("초대 사용 기한이 끝났어요.");
  await expect(page.getByRole("button", { name: "같은 요청 다시 보내기", exact: true })).toHaveCount(0);
  await expect(codeInput(page)).toBeEnabled(); fixture.check();
});
