import { test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/design/screens");

function todayAtUtc(hour: number, minute = 0): string {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

test("m17_calendar_screens_1440_and_390", async ({ page }) => {
  const login = uniqueLogin("m17shot");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const t1 = await page.request.post("/api/tags", { data: { name: "Work", color: "#3E6FB0" } });
  const t2 = await page.request.post("/api/tags", { data: { name: "Sport", color: "#2F6B4B" } });
  const work = (await t1.json()).id as string;
  const sport = (await t2.json()).id as string;
  const starts = todayAtUtc(11, 0);
  for (let i = 0; i < 3; i++) {
    await apiCreateNote(page.request, {
      title: `Shot note ${i}`,
      body: "",
      starts_at: starts,
      reminder_offsets: [],
      tag_ids: [i % 2 === 0 ? work : sport],
    });
  }
  await apiCreateNote(page.request, {
    title: "Afternoon plan",
    body: "",
    starts_at: todayAtUtc(15, 30),
    reminder_offsets: [],
    tag_ids: [work],
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calendar");
  await page.getByTestId("cal-view-week").click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "calendar-1440.png"), fullPage: true });

  await page.getByTestId("cal-view-month").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "calendar-month-1440.png"), fullPage: true });

  await page.getByTestId("cal-view-day").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "calendar-day-1440.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/calendar");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "calendar-390.png"), fullPage: true });
});
