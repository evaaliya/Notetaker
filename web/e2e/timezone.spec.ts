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
  // List can linger over the save button (pointer intercept) — close explicitly.
  await page.keyboard.press("Escape");
  await expect(page.locator("#tz-picker-list")).toHaveCount(0);
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
  await expect(page).toHaveURL(/\/notes\/new/);
  await page.getByTestId("meta-when-trigger").click();
  await expect(page.getByTestId("note-tz-hint")).toContainText(browserTz);
});

test("e2e_create_note_after_settings_tz_differs_from_device", async ({ page }) => {
  const login = uniqueLogin("tzcreate");
  await registerUi(page, login);
  const browserTz = await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const settingsTz =
    browserTz === "Pacific/Honolulu" ? "Europe/Berlin" : "Pacific/Honolulu";

  await page.goto("/settings");
  const tzInput = page.getByTestId("settings-timezone");
  await tzInput.fill(settingsTz);
  await page.getByRole("option", { name: settingsTz, exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  const me = await page.request.get("/api/me");
  expect((await me.json()).timezone).toBe(settingsTz);

  // Tomorrow 15:00 wall clock in settings TZ → UTC ISO (same as editor).
  const tomorrowLocal = await page.evaluate((tz) => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now.getTime() + 24 * 3600_000));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}T15:00`;
  }, settingsTz);

  await page.goto("/notes/new");
  await page.getByTestId("meta-when-trigger").click();
  await expect(page.getByTestId("note-tz-hint")).toContainText(settingsTz);
  await page.getByTestId("note-starts").fill(tomorrowLocal);
  const title = `TZ create ${Date.now()}`;
  await page.getByTestId("note-title").fill(title);
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/notes?q=" + encodeURIComponent(title));
      const body = (await res.json()) as { items: { title: string }[] };
      return body.items.some((n) => n.title === title);
    }, { timeout: 15_000 })
    .toBe(true);
});

test("e2e_past_reminder_shows_warning", async ({ page }) => {
  const login = uniqueLogin("tzpast");
  await registerUi(page, login);
  await page.goto("/notes/new");
  // Popovers are exclusive (D-093): set time first, then open reminders.
  await page.getByTestId("meta-when-trigger").click();
  // Event in 5 minutes + «за час» → fire_at already in the past.
  const starts = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  // Form interprets in user TZ; new users get browser TZ — use local components.
  const local = `${starts.getFullYear()}-${pad(starts.getMonth() + 1)}-${pad(starts.getDate())}T${pad(starts.getHours())}:${pad(starts.getMinutes())}`;
  await page.getByTestId("note-starts").fill(local);
  await page.getByTestId("meta-reminders-trigger").click();
  await page.getByTestId("reminder-offset-60").check();
  await expect(page.getByTestId("reminder-past-warning")).toBeVisible();
  await expect(page.getByTestId("reminder-past-warning")).toContainText(
    "это напоминание уже не сработает",
  );
});
