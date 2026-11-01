import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

test("e2e_calendar_slot_matches_label_timezone", async ({ page }) => {
  const login = uniqueLogin("m7slotz");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "Asia/Bishkek" } });

  // Today 11:41 in Asia/Bishkek (= 05:41Z) — calendar week uses that TZ, not UTC date.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // YYYY-MM-DD
  const starts = `${ymd}T05:41:00Z`;
  const title = `Slot1141 ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: starts,
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-week").click();
  const event = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(event).toBeVisible({ timeout: 15_000 });
  await expect(event).toHaveAttribute("data-hm", "11:41");
  // Agenda rail shows wall-clock start next to the hollow dot (not UTC 05:41).
  const day = event.locator("xpath=ancestor::*[@data-testid='tl-day']");
  await expect(day.locator(".tl-agenda-hm").filter({ hasText: "11:41" })).toBeVisible();
  await expect(event.locator(".tl-card-range")).toHaveText("11:41–12:11");
});

test("e2e_sidebar_fits_viewport", async ({ page }) => {
  const login = uniqueLogin("m7side");
  await registerUi(page, login);
  await page.request.patch("/api/me", {
    data: { email: "long.email.for.truncation@example.com" },
  });
  for (let i = 0; i < 20; i++) {
    await page.request.post("/api/tags", {
      data: { name: `Tag${i}_${Date.now()}`, color: "#3E6FB0" },
    });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/calendar");
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toBeVisible();
  if ((await sidebar.getAttribute("data-collapsed")) === "1") {
    await page.getByTestId("sidebar-toggle").click();
  }
  await expect(sidebar).toHaveAttribute("data-collapsed", "0");

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
  expect(inboxBox!.x).toBeGreaterThanOrEqual(sideW);
  expect(markBox!.x + markBox!.width).toBeLessThanOrEqual(inboxBox!.x + inboxBox!.width + 1);
  expect(markBox!.y).toBeGreaterThanOrEqual(inboxBox!.y - 1);

  await page.keyboard.press("Escape");
  await expect(inbox).toHaveCount(0);
});
