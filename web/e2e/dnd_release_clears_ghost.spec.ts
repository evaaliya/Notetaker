import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

function todayAtUtc(hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function setSidebarCollapsed(page: Page, collapsed: boolean): Promise<void> {
  const toggle = page.getByTestId("sidebar-toggle");
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toBeVisible();
  const isCollapsed = (await sidebar.getAttribute("data-collapsed")) === "1";
  if (isCollapsed !== collapsed) {
    await toggle.click();
  }
  await expect(sidebar).toHaveAttribute("data-collapsed", collapsed ? "1" : "0");
}

/** Arm timeline DnD, then drop pointer capture so card-only pointerup cannot finish. */
async function armThenLoseCapture(page: Page, card: Locator): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) throw new Error("no card box");
  const sx = box.x + Math.min(40, box.width / 2);
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 16, sy + 4, { steps: 4 });
  await expect(page.getByTestId("tl-dnd-ghost")).toHaveCount(1, { timeout: 3000 });
  await expect
    .poll(async () =>
      page.evaluate(() => document.body.classList.contains("cal-dnd-active")),
    )
    .toBe(true);

  const lost = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="tl-card"].is-dragging',
    ) as HTMLElement | null;
    if (!el) return { ok: false, reason: "no dragging card" };
    // Playwright mouse uses pointerId 1 in Chromium.
    for (const pid of [1, 0, 2]) {
      if (el.hasPointerCapture(pid)) {
        el.releasePointerCapture(pid);
        return { ok: true, pid, still: el.hasPointerCapture(pid) };
      }
    }
    // Capture may already be missing — still a valid sticky scenario.
    return { ok: true, pid: null, still: false };
  });
  expect(lost.ok, JSON.stringify(lost)).toBeTruthy();
}

async function assertDragChromeCleared(page: Page): Promise<void> {
  await expect(page.getByTestId("tl-dnd-ghost")).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(() => document.body.classList.contains("cal-dnd-active")),
    )
    .toBe(false);
  await expect(page.locator('[data-testid="tl-card"].is-dragging')).toHaveCount(0);
}

test.describe("e2e_dnd_release_clears_ghost", () => {
  test("day relocate — sidebar expanded, note panel closed", async ({ page }) => {
    const login = uniqueLogin("dndrel1");
    await registerUi(page, login);
    await page.request.patch("/api/me", { data: { timezone: "UTC" } });
    const title = `RelDayExp ${Date.now()}`;
    const note = await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(10, 25),
      reminder_offsets: [],
      tag_ids: [],
    });
    await page.goto("/calendar");
    await setSidebarCollapsed(page, false);
    await page.getByTestId("cal-view-day").click();
    const card = page.getByTestId("tl-card").filter({ hasText: title });
    await armThenLoseCapture(page, card);

    const hour12 = page.locator('[data-testid="tl-drop-hour"][data-cal-drop-hour="12"]').first();
    await hour12.scrollIntoViewIfNeeded();
    const t = await hour12.boundingBox();
    if (!t) throw new Error("no hour box");
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
    await page.mouse.up();

    await assertDragChromeCleared(page);
    await expect
      .poll(async () => {
        const body = await (await page.request.get(`/api/notes/${note.id}`)).json();
        return body.starts_at as string;
      })
      .toMatch(/T12:25:00Z$/);
  });

  test("day relocate — sidebar collapsed, note panel closed", async ({ page }) => {
    const login = uniqueLogin("dndrel2");
    await registerUi(page, login);
    await page.request.patch("/api/me", { data: { timezone: "UTC" } });
    const title = `RelDayCol ${Date.now()}`;
    const note = await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(9, 40),
      reminder_offsets: [],
      tag_ids: [],
    });
    await page.goto("/calendar");
    await setSidebarCollapsed(page, true);
    await page.getByTestId("cal-view-day").click();
    const card = page.getByTestId("tl-card").filter({ hasText: title });
    await armThenLoseCapture(page, card);

    const hour11 = page.locator('[data-testid="tl-drop-hour"][data-cal-drop-hour="11"]').first();
    await hour11.scrollIntoViewIfNeeded();
    const t = await hour11.boundingBox();
    if (!t) throw new Error("no hour box");
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
    await page.mouse.up();

    await assertDragChromeCleared(page);
    await expect
      .poll(async () => {
        const body = await (await page.request.get(`/api/notes/${note.id}`)).json();
        return body.starts_at as string;
      })
      .toMatch(/T11:40:00Z$/);
  });

  test("week relocate — note side panel open", async ({ page }) => {
    const login = uniqueLogin("dndrel3");
    await registerUi(page, login);
    await page.request.patch("/api/me", { data: { timezone: "UTC" } });
    const title = `RelWeekPanel ${Date.now()}`;
    const note = await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(13, 10),
      reminder_offsets: [],
      tag_ids: [],
    });
    await page.goto("/calendar");
    await setSidebarCollapsed(page, false);
    await page.getByTestId("cal-view-week").click();
    const card = page.getByTestId("tl-card").filter({ hasText: title });
    await card.click();
    await expect(page.getByTestId("note-side-panel")).toBeVisible();

    await armThenLoseCapture(page, card);

    const hour15 = page.locator('[data-cal-drop-hour="15"]').first();
    await hour15.scrollIntoViewIfNeeded();
    const t = await hour15.boundingBox();
    if (!t) throw new Error("no hour box");
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
    await page.mouse.up();

    await assertDragChromeCleared(page);
    await expect
      .poll(async () => {
        const body = await (await page.request.get(`/api/notes/${note.id}`)).json();
        return body.starts_at as string;
      })
      .toMatch(/T15:10:00Z$/);
  });

  test("day trash — sidebar expanded", async ({ page }) => {
    const login = uniqueLogin("dndrel4");
    await registerUi(page, login);
    await page.request.patch("/api/me", { data: { timezone: "UTC" } });
    const title = `TrashDayExp ${Date.now()}`;
    await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(16, 5),
      reminder_offsets: [],
      tag_ids: [],
    });
    await page.goto("/calendar");
    await setSidebarCollapsed(page, false);
    await page.getByTestId("cal-view-day").click();
    const card = page.getByTestId("tl-card").filter({ hasText: title });
    await armThenLoseCapture(page, card);

    const zone = page.getByTestId("cal-trash-zone");
    await expect(zone).toBeVisible();
    const z = await zone.boundingBox();
    if (!z) throw new Error("no trash box");
    await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 10 });
    await page.mouse.up();

    await assertDragChromeCleared(page);
    await expect(page.getByTestId("trash-undo")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("tl-card").filter({ hasText: title })).toHaveCount(0);
  });

  test("week trash — sidebar collapsed + note panel open", async ({ page }) => {
    const login = uniqueLogin("dndrel5");
    await registerUi(page, login);
    await page.request.patch("/api/me", { data: { timezone: "UTC" } });
    const title = `TrashWeekCol ${Date.now()}`;
    await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: todayAtUtc(17, 50),
      reminder_offsets: [],
      tag_ids: [],
    });
    await page.goto("/calendar");
    await setSidebarCollapsed(page, true);
    await page.getByTestId("cal-view-week").click();
    const card = page.getByTestId("tl-card").filter({ hasText: title });
    await card.click();
    await expect(page.getByTestId("note-side-panel")).toBeVisible();

    await armThenLoseCapture(page, card);

    const zone = page.getByTestId("cal-trash-zone");
    await expect(zone).toBeVisible();
    const z = await zone.boundingBox();
    if (!z) throw new Error("no trash box");
    await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 10 });
    await page.mouse.up();

    await assertDragChromeCleared(page);
    await expect(page.getByTestId("trash-undo")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("tl-card").filter({ hasText: title })).toHaveCount(0);
  });
});
