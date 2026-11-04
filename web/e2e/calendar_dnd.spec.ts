import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

function todayAtUtc(hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Mouse drag with movement past threshold (timeline mouse DnD). */
async function mouseDragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  // Re-query after target scroll — relocate can remount the card (detached DOM flake).
  await expect(source).toBeVisible();
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("missing bounding box for drag");
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  const tx = t.x + t.width / 2;
  const ty = t.y + t.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Cross move threshold before heading to target.
  await page.mouse.move(sx + 12, sy + 4, { steps: 2 });
  await page.mouse.move(tx, ty, { steps: 16 });
  await page.mouse.up();
}

async function showTrashZone(page: Page): Promise<Locator> {
  const zone = page.getByTestId("cal-trash-zone");
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="cal-trash-zone"]') as HTMLElement | null;
    if (el) {
      el.classList.add("visible", "active");
      el.style.opacity = "1";
      el.style.pointerEvents = "auto";
    }
  });
  await expect(zone).toBeVisible();
  return zone;
}

test("e2e_dnd_month_relocate_keeps_time", async ({ page }) => {
  const login = uniqueLogin("dndmon");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `DnDMonth ${Date.now()}`;
  const note = await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(14, 35),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-month").click();
  const event = page.locator(".fc-event").filter({ hasText: title });
  await expect(event).toBeVisible();

  const homeDate = await event.evaluate((el) => {
    const day = el.closest(".fc-daygrid-day");
    return day?.getAttribute("data-date") ?? "";
  });
  expect(homeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Prefer a day in the same month grid that is not today (avoid "other" month pads).
  const targetCell = page
    .locator(`.fc-daygrid-day[data-date]:not([data-date="${homeDate}"]):not(.fc-day-other)`)
    .first();
  await expect(targetCell).toBeVisible();
  const targetDate = await targetCell.getAttribute("data-date");
  expect(targetDate).toBeTruthy();
  expect(targetDate).not.toBe(homeDate);
  // FullCalendar dayGrid: Playwright locator.dragTo often skips eventDrop; raw mouse path works.
  const boxE = await event.boundingBox();
  const boxT = await targetCell.boundingBox();
  if (!boxE || !boxT) throw new Error("missing month drag boxes");
  await page.mouse.move(boxE.x + 5, boxE.y + 5);
  await page.mouse.down();
  await page.mouse.move(boxT.x + 30, boxT.y + 30, { steps: 20 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/notes/${note.id}`);
      const body = await res.json();
      return body.starts_at as string;
    })
    .not.toBe(note.starts_at);

  const after = await (await page.request.get(`/api/notes/${note.id}`)).json();
  expect(after.starts_at).toMatch(/:35:00Z$/);

  await page.reload();
  await page.getByTestId("cal-view-month").click();
  await expect(page.locator(".fc-event").filter({ hasText: title })).toBeVisible();
  const again = await (await page.request.get(`/api/notes/${note.id}`)).json();
  expect(again.starts_at).toBe(after.starts_at);
});

test("e2e_dnd_day_hour_keeps_minutes", async ({ page }) => {
  const login = uniqueLogin("dndday");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `DnDDay ${Date.now()}`;
  const note = await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(14, 35),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-day").click();
  await expect(page.getByTestId("tl-day-view")).toBeVisible();
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  const hour16 = page.locator('[data-testid="tl-drop-hour"][data-cal-drop-hour="16"]').first();
  await mouseDragTo(page, card, hour16);

  await expect
    .poll(async () => {
      const body = await (await page.request.get(`/api/notes/${note.id}`)).json();
      return body.starts_at as string;
    })
    .toMatch(/T16:35:00Z$/);
});

test("e2e_dnd_week_relocate_and_trash", async ({ page }) => {
  const login = uniqueLogin("dndweek");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `DnDWeek ${Date.now()}`;
  const note = await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(11, 20),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-week").click();
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();

  const hour15 = page.locator('[data-cal-drop-hour="15"]').first();
  await mouseDragTo(page, card, hour15);
  await expect
    .poll(async () => {
      const body = await (await page.request.get(`/api/notes/${note.id}`)).json();
      return body.starts_at as string;
    })
    .toMatch(/T15:20:00Z$/);

  const card2 = page.getByTestId("tl-card").filter({ hasText: title });
  const zone = await showTrashZone(page);
  await mouseDragTo(page, card2, zone);
  await expect(page.getByTestId("trash-undo")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("tl-card").filter({ hasText: title })).toHaveCount(0);
});

test("e2e_dnd_month_trash_desktop", async ({ page }) => {
  const login = uniqueLogin("dndmtr");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `DnDTrashM ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(13, 0),
    reminder_offsets: [],
    tag_ids: [],
  });
  await page.goto("/calendar");
  await page.getByTestId("cal-view-month").click();
  const event = page.locator(".fc-event").filter({ hasText: title });
  await expect(event).toBeVisible();
  const zone = await showTrashZone(page);
  await event.dragTo(zone, { force: true });
  await expect(page.getByTestId("trash-undo")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".fc-event").filter({ hasText: title })).toHaveCount(0);
});

test("e2e_dnd_mobile_day_trash", async ({ page }) => {
  const login = uniqueLogin("dndmob");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  await page.setViewportSize({ width: 390, height: 844 });
  const title = `DnDMob ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(10, 5),
    reminder_offsets: [],
    tag_ids: [],
  });
  await page.goto("/calendar");
  // Mobile chrome uses legacy testids from M13; day is default but switch explicitly.
  await page.getByTestId("cal-mobile-view-timeGridDay").click();
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  const zone = await showTrashZone(page);
  // Playwright drives mouse even at mobile viewport; validates mobile chrome + trash zone.
  // Touch long-press path is in useLongPressDrag (pointerType !== mouse).
  await mouseDragTo(page, card, zone);
  await expect(page.getByTestId("trash-undo")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("tl-card").filter({ hasText: title })).toHaveCount(0);
});

test("e2e_dnd_ghost_not_stuck_at_origin", async ({ page }) => {
  const login = uniqueLogin("dndgst");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `DnDGhost ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(12, 10),
    reminder_offsets: [],
    tag_ids: [],
  });
  await page.goto("/calendar");
  await page.getByTestId("cal-view-week").click();
  await expect(page.getByTestId("tl-card").filter({ hasText: title })).toBeVisible();
  await expect(page.getByTestId("tl-dnd-ghost")).toHaveCount(0);

  const card = page.getByTestId("tl-card").filter({ hasText: title });
  const box = await card.boundingBox();
  if (!box) throw new Error("no card box");
  // Start drag then Escape / cancel via pointercancel path: move then up off any drop.
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 5, { steps: 3 });
  const ghost = page.getByTestId("tl-dnd-ghost");
  await expect(ghost).toHaveCount(1);
  // Ghost is a visual clone of .tl-card (tag fill), not a white surface pill.
  const bg = await ghost.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(bg).not.toMatch(/^rgb\(\s*255,\s*255,\s*255\s*\)$/);
  await expect(ghost.locator(".tl-card-title")).toHaveText(title);
  await page.mouse.up();
  await expect(page.getByTestId("tl-dnd-ghost")).toHaveCount(0);
});

test("e2e_dnd_api_error_shows_and_keeps_note", async ({ page }) => {
  const login = uniqueLogin("dnderr");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `DnDErr ${Date.now()}`;
  const note = await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(9, 40),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.route(`**/api/notes/${note.id}*`, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "server_error", message: "forced fail" } }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-day").click();
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  const hour12 = page.locator('[data-testid="tl-drop-hour"][data-cal-drop-hour="12"]').first();
  await mouseDragTo(page, card, hour12);
  await expect(page.getByTestId("cal-drop-error")).toBeVisible({ timeout: 8000 });
  const body = await (await page.request.get(`/api/notes/${note.id}`)).json();
  expect(body.starts_at).toBe(note.starts_at);
  await expect(page.getByTestId("tl-card").filter({ hasText: title })).toBeVisible();
});
