import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

function todayAtUtc(hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

test("e2e_dnd_autoscroll_day_near_viewport_edge", async ({ page }) => {
  const login = uniqueLogin("dndasc");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `AutoScroll ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(8, 0),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.setViewportSize({ width: 1100, height: 520 });
  await page.goto("/calendar");
  await page.getByTestId("cal-view-day").click();

  await expect(page.getByTestId("calendar-main")).toBeVisible();
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();

  // Day timeline scrolls inside `.tl-day-view` (max-height), not only `.calendar-main`.
  const scroller = page.locator(".tl-day-view");
  await expect(scroller).toBeVisible();
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  const metrics = await scroller.evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(
    metrics.scrollHeight,
    "tl-day-view must be scrollable for this test",
  ).toBeGreaterThan(metrics.clientHeight + 40);
  const before = metrics.scrollTop;

  const box = await card.boundingBox();
  if (!box) throw new Error("no card box");
  const sx = box.x + box.width / 2;
  const sy = box.y + Math.min(12, box.height / 2);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 4, { steps: 2 });
  // Hold near bottom edge of the day scroller / viewport.
  const edgeY = await scroller.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return Math.min(window.innerHeight - 8, r.bottom - 8);
  });
  await page.mouse.move(sx, edgeY, { steps: 12 });
  await expect
    .poll(async () => scroller.evaluate((el) => el.scrollTop), { timeout: 4000 })
    .toBeGreaterThan(before);
  await page.mouse.up();
});
