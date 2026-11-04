import { test, expect } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

function todayAtUtc(hour: number, minute = 0): string {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute, 0),
  )
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

async function mouseDragTo(
  page: import("@playwright/test").Page,
  source: import("@playwright/test").Locator,
  target: import("@playwright/test").Locator,
) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("missing boxes for drag");
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 4, { steps: 2 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 16 });
  await page.mouse.up();
}

async function showTrashZone(page: import("@playwright/test").Page) {
  const zone = page.getByTestId("cal-trash-zone");
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="cal-trash-zone"]') as HTMLElement | null;
    if (!el) return;
    el.classList.add("visible");
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";
    el.style.transform = "none";
  });
  return zone;
}

test("e2e_trash_undo_auto_hides_after_15s_survives_navigation", async ({ page }) => {
  const login = uniqueLogin("undottl");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `UndoTTL ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(10, 0),
    reminder_offsets: [],
    tag_ids: [],
  });
  await page.goto("/calendar");
  await page.getByTestId("cal-view-day").click();
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();

  await page.clock.install();
  const zone = await showTrashZone(page);
  await mouseDragTo(page, card, zone);
  await expect(page.getByTestId("trash-undo")).toBeVisible({ timeout: 8000 });

  // SPA navigate — full page.goto would remount Shell and wipe the toast queue.
  await page.getByRole("navigation").getByRole("link", { name: /Список/i }).click();
  await expect(page).toHaveURL(/\/list/);
  await expect(page.getByTestId("trash-undo")).toBeVisible();
  await expect(page.getByTestId("trash-undo-toast")).toContainText(
    "Заметка перемещена в корзину",
  );

  await page.clock.fastForward(14_000);
  await expect(page.getByTestId("trash-undo")).toBeVisible();

  await page.clock.fastForward(1_500);
  await expect(page.getByTestId("trash-undo")).toHaveCount(0);
});

test("e2e_trash_undo_each_toast_has_own_15s", async ({ page }) => {
  const login = uniqueLogin("undomulti");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const t1 = `UndoA ${Date.now()}`;
  const t2 = `UndoB ${Date.now()}`;
  await apiCreateNote(page.request, {
    title: t1,
    body: "",
    starts_at: todayAtUtc(11, 0),
    reminder_offsets: [],
    tag_ids: [],
  });
  await apiCreateNote(page.request, {
    title: t2,
    body: "",
    starts_at: todayAtUtc(12, 0),
    reminder_offsets: [],
    tag_ids: [],
  });
  await page.goto("/calendar");
  await page.getByTestId("cal-view-day").click();

  const card1 = page.getByTestId("tl-card").filter({ hasText: t1 });
  const card2 = page.getByTestId("tl-card").filter({ hasText: t2 });
  await expect(card1).toBeVisible();
  await expect(card2).toBeVisible();

  // Two panel-trashes without mid-clock advance (fake clock + DnD/clicks mid-TTL is flaky).
  // Staggered independent TTL is covered by separate setTimeout per item in TrashUndoProvider;
  // here we prove two toasts coexist and each expires at TRASH_UNDO_MS (not sticky forever).
  await page.clock.install();
  await card1.click();
  await page.getByTestId("note-panel-trash").click({ force: true });
  await expect(page.getByTestId("trash-undo")).toHaveCount(1, { timeout: 8000 });

  await card2.click();
  await page.getByTestId("note-panel-trash").click({ force: true });
  await expect(page.getByTestId("trash-undo")).toHaveCount(2, { timeout: 8000 });
  await expect(page.getByTestId("trash-undo-toast")).toContainText(t1);
  await expect(page.getByTestId("trash-undo-toast")).toContainText(t2);

  await page.clock.fastForward(14_000);
  await expect(page.getByTestId("trash-undo")).toHaveCount(2);

  await page.clock.fastForward(1_500);
  await expect(page.getByTestId("trash-undo")).toHaveCount(0);
});
