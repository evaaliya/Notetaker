import { expect, test } from "@playwright/test";
import { formatInZone, formatTimeHm } from "../src/format";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

test("formatTimeHm_always_hhmm_in_zone", () => {
  // :00 must not collapse to a bare hour (FullCalendar omitZeroMinute bug class).
  expect(formatTimeHm("2026-10-25T04:00:00Z", "UTC")).toBe("04:00");
  expect(formatTimeHm("2026-10-24T02:22:00Z", "UTC")).toBe("02:22");
  // Asia/Bishkek = UTC+6
  expect(formatTimeHm("2026-10-25T04:00:00Z", "Asia/Bishkek")).toBe("10:00");
  expect(formatTimeHm("2026-10-24T02:22:00Z", "Asia/Bishkek")).toBe("08:22");
});

test("formatInZone_includes_hhmm", () => {
  const s = formatInZone("2026-10-25T04:00:00Z", "UTC");
  expect(s).toMatch(/04:00/);
});

test("e2e_calendar_list_upcoming_time_hhmm", async ({ page }) => {
  const login = uniqueLogin("hmfmt");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });

  const titleOnHour = `OnHour ${Date.now()}`;
  const titleWithMin = `WithMin ${Date.now()}`;
  await apiCreateNote(page.request, {
    title: titleOnHour,
    body: "",
    starts_at: "2026-10-25T04:00:00Z",
    reminder_offsets: [],
    tag_ids: [],
    recurrence: { freq: "daily", until: "2026-10-25", tz: "UTC" },
  });
  await apiCreateNote(page.request, {
    title: titleWithMin,
    body: "",
    starts_at: "2026-10-24T08:22:00Z",
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  const onHourEvent = page.locator(".fc-event").filter({ hasText: titleOnHour });
  const withMinEvent = page.locator(".fc-event").filter({ hasText: titleWithMin });
  await expect(onHourEvent).toBeVisible();
  await expect(withMinEvent).toBeVisible();
  await expect(onHourEvent).toContainText("04:00");
  await expect(withMinEvent).toContainText("08:22");
  // Regression: month view must not show bare "04" without minutes.
  await expect(onHourEvent).not.toHaveText(/^04\s/);

  await page.goto("/list");
  const listOnHour = page.getByRole("button", { name: new RegExp(titleOnHour) });
  const listWithMin = page.getByRole("button", { name: new RegExp(titleWithMin) });
  await expect(listOnHour).toContainText(/\d{2}:\d{2}/);
  await expect(listWithMin).toContainText("08:22");

  await page.goto("/upcoming");
  await expect(page.getByText(titleOnHour).first()).toBeVisible();
  // Bucket rows show occurrence time as HH:MM (via formatInZone).
  const row = page.locator(".note-row").filter({ hasText: titleOnHour });
  await expect(row).toContainText(/\d{2}:\d{2}/);
});
