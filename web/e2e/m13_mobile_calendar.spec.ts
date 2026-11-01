import { test, expect } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

function todayAtUtc(hour: number, minute: number): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

test("m13_mobile_calendar_day_nav_and_sheet", async ({ page }) => {
  const login = uniqueLogin("m13cal");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `MobCal ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "mobile",
    starts_at: todayAtUtc(15, 0),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calendar");

  await expect(page.getByTestId("cal-mobile-chrome")).toBeVisible();
  await expect(page.getByTestId("cal-mobile-views")).toBeVisible();
  await expect(page.getByTestId("cal-mobile-view-timeGridDay")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const titleBefore = await page.getByTestId("cal-mobile-title").innerText();
  await page.getByTestId("cal-mobile-next").click();
  await expect
    .poll(async () => page.getByTestId("cal-mobile-title").innerText())
    .not.toBe(titleBefore);
  await page.getByTestId("cal-mobile-today").click();

  await page.getByTestId("cal-mobile-view-dayGridMonth").click();
  await expect(page.getByTestId("cal-mobile-view-dayGridMonth")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByTestId("cal-mobile-view-timeGridDay").click();

  const event = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(event).toBeVisible({ timeout: 10_000 });
  await event.click();
  await expect(page.getByTestId("note-panel-sheet-backdrop")).toBeVisible();
  await expect(page.getByTestId("note-side-panel")).toBeVisible();
  await expect(page.getByTestId("note-panel-trash")).toBeVisible();
  await page.getByTestId("note-panel-close").click();
  await expect(page.getByTestId("note-panel-sheet-backdrop")).toHaveCount(0);

  // No horizontal page scroll on calendar.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

test("m13_mobile_notifications_from_more", async ({ page }) => {
  const login = uniqueLogin("m13n");
  await registerUi(page, login);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/list");
  await page.getByTestId("mobile-nav-more").click();
  await expect(page.getByTestId("mobile-nav-notifications")).toBeVisible();
  await page.getByTestId("mobile-nav-notifications").click();
  await expect(page.locator(".notif-popover")).toBeVisible();
});
