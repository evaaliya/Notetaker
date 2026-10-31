import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

test("e2e_calendar_slot_matches_label_timezone", async ({ page }) => {
  const login = uniqueLogin("m7slotz");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "Asia/Bishkek" } });

  // 11:41 Asia/Bishkek = 05:41 UTC (+06).
  const title = `Slot1141 ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: "2026-10-29T05:41:00Z",
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  await page.locator(".fc-timeGridWeek-button").click();
  // Event is on a fixed past date — walk both directions from "today".
  for (let i = 0; i < 30; i++) {
    if ((await page.locator(".fc-event").filter({ hasText: title }).count()) > 0) break;
    await page.locator(".fc-prev-button").click();
    await page.waitForTimeout(80);
  }
  for (let i = 0; i < 60; i++) {
    if ((await page.locator(".fc-event").filter({ hasText: title }).count()) > 0) break;
    await page.locator(".fc-next-button").click();
    await page.waitForTimeout(80);
  }

  const event = page.locator(".fc-event").filter({ hasText: title });
  await expect(event).toBeVisible();
  await expect(event.locator(".cal-event-time")).toHaveText("11:41");

  // Ensure mid-morning slots are in view for measurement.
  await page.locator('.fc-timegrid-slot-lane[data-time="11:00:00"]').scrollIntoViewIfNeeded();

  const eventBox = await event.boundingBox();
  const slot11 = await page.locator('.fc-timegrid-slot-lane[data-time="11:00:00"]').boundingBox();
  const slot12 = await page.locator('.fc-timegrid-slot-lane[data-time="12:00:00"]').boundingBox();
  const slot05 = await page.locator('.fc-timegrid-slot-lane[data-time="05:00:00"]').boundingBox();
  expect(eventBox).toBeTruthy();
  expect(slot11).toBeTruthy();
  expect(slot12).toBeTruthy();
  expect(slot05).toBeTruthy();

  const top = eventBox!.y;
  // Event must sit in the 11:00–12:00 band, not near 05:00 UTC band.
  expect(top).toBeGreaterThanOrEqual(slot11!.y - 4);
  expect(top).toBeLessThan(slot12!.y);
  const dist11 = Math.abs(top - slot11!.y);
  const dist05 = Math.abs(top - slot05!.y);
  expect(dist11).toBeLessThan(dist05);
});

test("e2e_sidebar_fits_viewport", async ({ page }) => {
  const login = uniqueLogin("m7side");
  await registerUi(page, login);
  await page.request.patch("/api/me", {
    data: { email: "long.email.for.truncation@example.com" },
  });
  // Many tags to stress vertical layout — only tags scroll, footer stays.
  for (let i = 0; i < 20; i++) {
    await page.request.post("/api/tags", {
      data: { name: `Tag${i}_${Date.now()}`, color: "#3E6FB0" },
    });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/calendar");
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toBeVisible();
  // Expand for footer/email layout check (default is collapsed 64px).
  if ((await sidebar.getAttribute("data-collapsed")) === "1") {
    await page.getByTestId("sidebar-toggle").click();
  }
  await expect(sidebar).toHaveAttribute("data-collapsed", "0");

  // Allow 2px subpixel/scrollbar slack after expand animation.
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0, { timeout: 2000 })
    .toBeGreaterThan(200);
  const noHScroll = await sidebar.evaluate((el) => el.scrollWidth <= el.clientWidth + 2);
  expect(noHScroll).toBe(true);

  const user = page.getByTestId("side-user");
  const bell = page.getByTestId("notif-bell");
  const userBox = await user.boundingBox();
  const bellBox = await bell.boundingBox();
  expect(userBox).toBeTruthy();
  expect(bellBox).toBeTruthy();
  expect(userBox!.y + userBox!.height).toBeLessThanOrEqual(720 + 1);
  expect(userBox!.x + userBox!.width).toBeLessThanOrEqual(248 + 8);
  expect(bellBox!.y + bellBox!.height).toBeLessThanOrEqual(720 + 1);
  await expect(user.getByRole("button", { name: "Выйти" })).toBeVisible();
});

test("e2e_notifications_popover", async ({ page }) => {
  const login = uniqueLogin("m7pop");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });

  const title = `NotifPop ${Date.now()}`;
  const note = await apiCreateNote(page.request, {
    title,
    body: "скоро",
    starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [10],
    tag_ids: [],
  });
  const due = await page.request.post("/api/e2e/make_reminder_due", {
    data: { note_id: note.id },
  });
  expect(due.ok(), await due.text()).toBeTruthy();
  const tick = await page.request.post("/api/e2e/tick_reminders");
  expect(tick.ok(), await tick.text()).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/upcoming");
  const sidebar = page.getByTestId("app-sidebar");
  const sideW =
    (await sidebar.getAttribute("data-collapsed")) === "1" ? 64 : 248;
  await page.getByTestId("notif-bell").click();
  const inbox = page.getByTestId("notif-inbox");
  await expect(inbox).toBeVisible();
  await expect(inbox.getByRole("heading", { name: "Уведомления" })).toBeVisible();
  const markAll = page.getByTestId("notif-mark-all");
  await expect(markAll).toBeVisible();

  const inboxBox = await inbox.boundingBox();
  const markBox = await markAll.boundingBox();
  expect(inboxBox).toBeTruthy();
  expect(markBox).toBeTruthy();
  // Popover sits in main (to the right of sidebar), not clipped.
  expect(inboxBox!.x).toBeGreaterThanOrEqual(sideW);
  expect(markBox!.x + markBox!.width).toBeLessThanOrEqual(inboxBox!.x + inboxBox!.width + 1);
  expect(markBox!.y).toBeGreaterThanOrEqual(inboxBox!.y - 1);

  await page.keyboard.press("Escape");
  await expect(inbox).toHaveCount(0);
});
