/**
 * M26: real-phone touch open + insecure-context (http://LAN-IP) UUID.
 */
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

function todayAtUtc(hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function dispatchTouchHold(
  page: Page,
  cdp: CDPSession,
  x: number,
  y: number,
  holdMs: number,
  movePx = 0,
): Promise<{ durationMs: number }> {
  const startedAt = Date.now();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  if (movePx > 0) {
    // Travel after long-press arm so didDrag becomes true.
    await page.waitForTimeout(Math.max(holdMs, 360));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + movePx, y: y + 2 }],
    });
    await page.waitForTimeout(40);
  } else {
    await page.waitForTimeout(holdMs);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  return { durationMs: Date.now() - startedAt };
}

function stripRandomUUID(): void {
  Object.defineProperty(Crypto.prototype, "randomUUID", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

test.describe("M26 touch + insecure context", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("e2e_touch_tl_card_quick_tap_opens_panel", async ({ page, context }) => {
    const login = uniqueLogin("m26q");
    await registerUi(page, login);
    await page.request.patch("/api/me", { data: { timezone: "UTC" } });
    const title = `M26Quick ${Date.now()}`;
    await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(15, 0),
      reminder_offsets: [],
      tag_ids: [],
    });

    await page.goto("/calendar");
    await page.getByTestId("cal-mobile-view-timeGridDay").click();
    const card = page.getByTestId("tl-card").filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 10_000 });
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    const cdp = await context.newCDPSession(page);
    const timing = await dispatchTouchHold(page, cdp, x, y, 80);
    expect(timing.durationMs).toBeLessThan(150);

    await expect(page.getByTestId("note-side-panel")).toBeVisible({ timeout: 5_000 });
  });

  test("e2e_touch_tl_card_hold_without_move_opens_panel", async ({ page, context }) => {
    const login = uniqueLogin("m26h");
    await registerUi(page, login);
    await page.request.patch("/api/me", { data: { timezone: "UTC" } });
    const title = `M26Hold ${Date.now()}`;
    await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(16, 0),
      reminder_offsets: [],
      tag_ids: [],
    });

    await page.goto("/calendar");
    await page.getByTestId("cal-mobile-view-timeGridDay").click();
    const card = page.getByTestId("tl-card").filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 10_000 });
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    const cdp = await context.newCDPSession(page);
    const timing = await dispatchTouchHold(page, cdp, x, y, 450);
    expect(timing.durationMs).toBeGreaterThanOrEqual(450);

    // Long-press arm without travel must still open (didDrag only after move).
    await expect(page.getByTestId("note-side-panel")).toBeVisible({ timeout: 5_000 });
  });

  test("e2e_touch_tl_card_hold_then_move_suppresses_open", async ({ page, context }) => {
    const login = uniqueLogin("m26d");
    await registerUi(page, login);
    await page.request.patch("/api/me", { data: { timezone: "UTC" } });
    const title = `M26Drag ${Date.now()}`;
    await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(14, 0),
      reminder_offsets: [],
      tag_ids: [],
    });

    await page.goto("/calendar");
    await page.getByTestId("cal-mobile-view-timeGridDay").click();
    const card = page.getByTestId("tl-card").filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 10_000 });
    const box = await card.boundingBox();
    expect(box).toBeTruthy();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    const cdp = await context.newCDPSession(page);
    await dispatchTouchHold(page, cdp, x, y, 450, 24);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("note-side-panel")).toHaveCount(0);
  });

  test("e2e_insecure_context_notes_new_opens", async ({ page }) => {
    const login = uniqueLogin("m26u");
    await registerUi(page, login);

    await page.addInitScript(stripRandomUUID);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await page.goto("/notes/new");
    await expect(page.getByTestId("note-editor-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("note-title")).toBeVisible();
    expect(pageErrors.filter((e) => /randomUUID/i.test(e))).toEqual([]);
  });

  test("e2e_insecure_context_existing_note_opens", async ({ page }) => {
    const login = uniqueLogin("m26e");
    await registerUi(page, login);
    const note = await apiCreateNote(page.request, {
      title: `M26Exist ${Date.now()}`,
      body: "x",
      starts_at: todayAtUtc(12, 0),
      reminder_offsets: [],
      tag_ids: [],
    });

    await page.addInitScript(stripRandomUUID);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await page.goto(`/notes/${note.id}`);
    await expect(page.getByTestId("note-editor-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("note-title")).toHaveValue(note.title, { timeout: 10_000 });
    expect(pageErrors.filter((e) => /randomUUID/i.test(e))).toEqual([]);
  });

  test("e2e_list_note_opens_editor", async ({ page }) => {
    const login = uniqueLogin("m26l");
    await registerUi(page, login);
    const title = `M26List ${Date.now()}`;
    const note = await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(11, 0),
      reminder_offsets: [],
      tag_ids: [],
    });

    await page.goto("/list");
    await page.getByTestId("list-note-main").filter({ hasText: title }).click();
    await expect(page).toHaveURL(new RegExp(`/notes/${note.id}`));
    await expect(page.getByTestId("note-editor-page")).toBeVisible();
  });
});
