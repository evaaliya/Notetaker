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

  await page.locator(`[data-testid="month-day-seg"][aria-label="${b}"]`).click();
  await expect(page.getByTestId("note-side-panel")).toBeVisible();
  await expect(page.getByTestId("note-side-panel").locator("input").first()).toHaveValue(b);
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
  await expect(page.getByTestId("tl-week")).toHaveClass(/tl-week-agenda/);
  await expect(page.getByTestId("tl-day-heading")).toHaveCount(7);
  // Empty days still show default spine (line + circles).
  await expect(page.getByTestId("tl-week-spine").first()).toBeVisible();
  await expect(page.locator(".tl-agenda-dot").first()).toBeVisible();
  // Weekday labels are Russian short forms (not Mon/Tue).
  await expect(page.locator(".tl-agenda-wd").first()).toHaveText(/^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)$/);
  await expect(page.locator(".tl-agenda-wd").filter({ hasText: /^(Mon|Tue|Wed)$/ })).toHaveCount(0);
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-hm", "14:30");
  await expect(card.locator(".tl-card-range")).toHaveText("14:30–15:00");
  await expect(card.locator(".tl-card-title")).toHaveText(title);
  await expect(page.locator(".tl-agenda-hm").filter({ hasText: "14:30" })).toBeVisible();
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
  // 24h spine: hour ticks remain where there is no note (note replaces its hour).
  await expect(page.getByTestId("tl-hours")).toBeVisible();
  await expect(page.getByTestId("tl-hours").locator(".tl-agenda-row")).toHaveCount(24);
  await expect(page.locator(".tl-agenda-hm").filter({ hasText: "09:15" })).toBeVisible();
  await expect(page.locator(".tl-agenda-dot")).toHaveCount(24);
  const card = page.getByTestId("tl-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-hm", "09:15");
  await expect(card.locator(".tl-card-range")).toHaveText("09:15–09:45");
  // Taller note pills.
  const h = await card.evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(70);
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
  await expect(page.getByTestId("note-side-panel").locator("input").first()).toHaveValue(
    titles[5],
  );
});

/** Late timed series must not spill into the next day cell (D-104). */
test("e2e_month_late_series_no_midnight_spill", async ({ page }) => {
  const login = uniqueLogin("m17spill");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });

  const sport = await ensureTag(page, "sport", "#3E6FB0");
  const work = await ensureTag(page, "work", "#B4402F");

  // Three consecutive UTC midnights: base day, +1, +2 at 23:29 (would spill +1h without clamp).
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  // Use a fixed mid-month day so month view always shows the cluster.
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const day = 10;
  const at = (d: number, hh: number, mm: number) =>
    new Date(Date.UTC(y, m, d, hh, mm, 0)).toISOString().replace(/\.\d{3}Z$/, "Z");

  const seriesTitle = `JogSpill_${Date.now()}`;
  const otherTitle = `OtherSpill_${Date.now()}`;
  const until = `${y}-${String(m + 1).padStart(2, "0")}-${String(day + 2).padStart(2, "0")}`;

  await apiCreateNote(page.request, {
    title: seriesTitle,
    body: "run",
    starts_at: at(day, 23, 29),
    reminder_offsets: [],
    tag_ids: [sport],
    recurrence: { freq: "daily", until, tz: "UTC" },
  });
  await apiCreateNote(page.request, {
    title: otherTitle,
    body: "alt",
    starts_at: at(day + 1, 0, 46),
    reminder_offsets: [],
    tag_ids: [work],
  });

  await page.goto("/calendar");
  await page.getByTestId("cal-view-month").click();
  await expect(page.getByTestId("calendar-main")).toHaveAttribute("data-cal-view", "month");

  const midDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(day + 1).padStart(2, "0")}`;
  const nextDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(day + 2).padStart(2, "0")}`;
  const midCell = page.locator(`.fc-daygrid-day[data-date="${midDate}"]`);
  const nextCell = page.locator(`.fc-daygrid-day[data-date="${nextDate}"]`);
  await expect(midCell).toBeVisible();

  // Switch main on middle day to the non-series note.
  await midCell.locator(`[data-testid="month-day-seg"][aria-label="${otherTitle}"]`).click();
  await expect(page.getByTestId("note-side-panel")).toBeVisible();
  await expect(midCell.getByTestId("month-main-pill").filter({ hasText: otherTitle })).toBeVisible();

  // No FC "+N ещё" from a spilled previous-day timed event.
  await expect(midCell.locator(".fc-daygrid-more-link")).toHaveCount(0);

  // Next day keeps its own series pill — not a multi-day continuation from mid day.
  await expect(nextCell.getByTestId("month-main-pill").filter({ hasText: seriesTitle })).toBeVisible();
  await expect(nextCell.locator(".fc-event.fc-event-end:not(.fc-event-start)")).toHaveCount(0);

  // Switch back to series on middle day — still no spill artifacts.
  await midCell.locator(`[data-testid="month-day-seg"][aria-label="${seriesTitle}"]`).click();
  await expect(midCell.getByTestId("month-main-pill").filter({ hasText: seriesTitle })).toBeVisible();
  await expect(midCell.locator(".fc-daygrid-more-link")).toHaveCount(0);
  await expect(nextCell.getByTestId("month-main-pill").filter({ hasText: seriesTitle })).toBeVisible();
});
