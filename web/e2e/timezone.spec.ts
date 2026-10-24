import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

test("e2e_timezone_change_updates_display_keeps_instant", async ({ page }) => {
  const login = uniqueLogin("tzui");
  await registerUi(page, login);
  const browserTz = await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const targetTz = browserTz === "America/New_York" ? "Asia/Tokyo" : "America/New_York";

  // Fixed UTC instant — wall clock must change with timezone, ISO must not.
  const title = `TZ note ${Date.now()}`;
  const note = await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: "2026-10-24T15:00:00Z",
    reminder_offsets: [60],
    tag_ids: [],
  });
  const startsAt = note.starts_at;

  await page.goto("/list");
  const display = page.locator(`[data-testid="note-starts-display"][data-note-id="${note.id}"]`);
  await expect(display).toBeVisible();
  const beforeText = (await display.innerText()).trim();

  await page.goto("/settings");
  await expect(page.getByTestId("timezone-picker")).toBeVisible();
  const tzInput = page.getByTestId("settings-timezone");
  await tzInput.fill(targetTz);
  await page.getByRole("option", { name: targetTz, exact: true }).click();
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  await page.goto("/list");
  await expect(display).toBeVisible();
  const afterText = (await display.innerText()).trim();
  expect(afterText).not.toEqual(beforeText);

  const got = await page.request.get(`/api/notes/${note.id}`);
  expect(got.ok()).toBeTruthy();
  const body = await got.json();
  expect(body.starts_at).toBe(startsAt);

  const me = await page.request.get("/api/me");
  expect((await me.json()).timezone).toBe(targetTz);
});

test("e2e_register_uses_browser_timezone", async ({ page }) => {
  const login = uniqueLogin("tzreg");
  const browserTz = await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  await registerUi(page, login);
  const me = await page.request.get("/api/me");
  expect((await me.json()).timezone).toBe(browserTz);

  await page.goto("/list");
  await page.getByTestId("new-note").click();
  await expect(page.getByTestId("note-tz-hint")).toContainText(browserTz);
});

test("e2e_past_reminder_shows_warning", async ({ page }) => {
  const login = uniqueLogin("tzpast");
  await registerUi(page, login);
  await page.goto("/list");
  await page.getByTestId("new-note").click();

  // Event in 5 minutes + «за час» → fire_at already in the past.
  const starts = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Form interprets in user TZ; new users get browser TZ — use local components.
  const local = `${starts.getFullYear()}-${pad(starts.getMonth() + 1)}-${pad(starts.getDate())}T${pad(starts.getHours())}:${pad(starts.getMinutes())}`;
  await page.getByTestId("note-starts").fill(local);
  await page.getByTestId("reminder-offset-60").check();
  await expect(page.getByTestId("reminder-past-warning")).toBeVisible();
  await expect(page.getByTestId("reminder-past-warning")).toContainText(
    "это напоминание уже не сработает",
  );
});
