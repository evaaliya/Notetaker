import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

function todayAtUtc(hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function ensureTag(
  page: import("@playwright/test").Page,
  name: string,
  color: string,
): Promise<string> {
  const list = await page.request.get("/api/tags");
  const tags = (await list.json()) as { id: string; name: string }[];
  const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const res = await page.request.post("/api/tags", { data: { name, color } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

test("e2e_month_main_pill_and_segments", async ({ page }) => {
  const login = uniqueLogin("m17mp");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const work = await ensureTag(page, "work", "#3E6FB0");
  const sport = await ensureTag(page, "sport", "#2F6B4B");
  const home = await ensureTag(page, "home", "#B07A1C");
  const starts = todayAtUtc(10, 0);
  const titles: string[] = [];
  for (let i = 0; i < 3; i++) {
    const title = `M17Main${i}_${Date.now()}`;
    titles.push(title);
    await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: starts,
      reminder_offsets: [],
      tag_ids: [[work, sport, home][i]],
    });
    // Ensure created_at order: small delay via sequential awaits is enough.
  }

  await page.goto("/calendar");
  await page.getByTestId("cal-view-month").click();
  await expect(page.getByTestId("calendar-main")).toHaveAttribute("data-cal-view", "month");

  // One main pill (first created).
  const mains = page.getByTestId("month-main-pill");
  await expect(mains.filter({ hasText: titles[0] })).toBeVisible();
  await expect(page.locator(".fc-event").filter({ hasText: titles[1] })).toHaveCount(0);
  await expect(page.locator(".fc-event").filter({ hasText: titles[2] })).toHaveCount(0);

  const segs = page.getByTestId("month-day-segments").first();
  await expect(segs).toBeVisible();
  await expect(segs.getByTestId("month-day-seg")).toHaveCount(3);
});

test("e2e_month_segment_switches_main_and_opens_panel", async ({ page }) => {
  const login = uniqueLogin("m17seg");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const starts = todayAtUtc(11, 0);
  const a = `M17A_${Date.now()}`;
  const b = `M17B_${Date.now()}`;
  await apiCreateNote(page.request, {
    title: a,
    body: "",
    starts_at: starts,
    reminder_offsets: [],
    tag_ids: [],
  });
  await apiCreateNote(page.request, {
    title: b,
    body: "",
    starts_at: starts,
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-month").click();
  await expect(page.getByTestId("month-main-pill").filter({ hasText: a })).toBeVisible();

  const segs = page.getByTestId("month-day-seg");
  await segs.nth(1).click();
  await expect(page.getByTestId("note-side-panel")).toBeVisible();
  await expect(page.getByTestId("note-side-panel")).toContainText(b);
  await expect(page.getByTestId("month-main-pill").filter({ hasText: b })).toBeVisible();

  await page.reload();
  await page.getByTestId("cal-view-month").click();
  // Session main does not persist — back to first created.
  await expect(page.getByTestId("month-main-pill").filter({ hasText: a })).toBeVisible();
});

test("e2e_week_timeline_layout", async ({ page }) => {
  const login = uniqueLogin("m17wk");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `M17Week_${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "созвон",
    starts_at: todayAtUtc(14, 30),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-week").click();
  await expect(page.getByTestId("tl-week")).toBeVisible();
  await expect(page.locator(".fc-timegrid")).toHaveCount(0);
  await expect(page.getByTestId("tl-day-heading")).toHaveCount(7);
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-hm", "14:30");
  await expect(card.locator(".note-illustration")).toHaveCount(0);
  await expect(card.getByTestId("tag-pill")).toHaveCount(0);
});

test("e2e_day_timeline_hours", async ({ page }) => {
  const login = uniqueLogin("m17day");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `M17Day_${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(9, 15),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-day").click();
  await expect(page.getByTestId("tl-day-view")).toBeVisible();
  await expect(page.getByTestId("tl-hours")).toBeVisible();
  await expect(page.getByTestId("tl-hours")).toContainText("09:00");
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-hm", "09:15");
});

test("e2e_timeline_overflow_plus_n", async ({ page }) => {
  const login = uniqueLogin("m17ov");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const starts = todayAtUtc(16, 0);
  const titles: string[] = [];
  for (let i = 0; i < 6; i++) {
    const title = `M17Ov${i}_${Date.now()}`;
    titles.push(title);
    await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: starts,
      reminder_offsets: [],
      tag_ids: [],
    });
  }

  await page.goto("/calendar");
  await page.getByTestId("cal-view-day").click();
  await expect(page.getByTestId("tl-card")).toHaveCount(4);
  await expect(page.getByTestId("tl-overflow-btn")).toContainText("+2 ещё");
  await page.getByTestId("tl-overflow-btn").click();
  await expect(page.getByTestId("tl-overflow-list")).toBeVisible();
  await page.getByTestId("tl-overflow-item").filter({ hasText: titles[5] }).click();
  await expect(page.getByTestId("note-side-panel")).toBeVisible();
  await expect(page.getByTestId("note-side-panel")).toContainText(titles[5]);
});
