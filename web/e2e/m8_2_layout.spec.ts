import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/design/screens");

test("e2e_create_is_page", async ({ page }) => {
  const login = uniqueLogin("m82create");
  await registerUi(page, login);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/list");
  await page.getByTestId("new-note").click();
  await expect(page).toHaveURL(/\/notes\/new$/);
  await expect(page.getByTestId("note-form")).toBeVisible();
  await expect(page.getByTestId("note-body")).toBeVisible();
  await expect(page.getByLabel("Текст")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("e2e_reminders_in_one_row", async ({ page }) => {
  const login = uniqueLogin("m82rem");
  await registerUi(page, login);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/notes/new");
  await expect(page.getByTestId("reminder-offsets-row")).toBeVisible();
  const boxes = await Promise.all(
    [10, 60, 1440].map(async (m) => {
      const box = await page.getByTestId(`reminder-offset-${m}`).boundingBox();
      expect(box).toBeTruthy();
      return box!;
    }),
  );
  const ys = boxes.map((b) => b.y);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
});

test("e2e_sidebar_collapse", async ({ page }) => {
  const login = uniqueLogin("m82side");
  await registerUi(page, login);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calendar");

  // Default collapsed → 64px.
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toHaveAttribute("data-collapsed", "1");
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0, { timeout: 2000 })
    .toBeLessThanOrEqual(66);

  await page.getByTestId("sidebar-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "0");
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0, { timeout: 2000 })
    .toBeGreaterThanOrEqual(240);

  await page.getByTestId("sidebar-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "1");
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0, { timeout: 2000 })
    .toBeLessThanOrEqual(66);

  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "1");
  await expect
    .poll(async () => (await page.getByTestId("app-sidebar").boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(66);
});

test("e2e_toolbar_one_row", async ({ page }) => {
  const login = uniqueLogin("m82tb");
  await registerUi(page, login);
  for (let i = 0; i < 3; i++) {
    await page.request.post("/api/tags", {
      data: { name: `TB${i}_${Date.now()}`, color: "#3E6FB0" },
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/list");
  await expect(page.getByTestId("list-toolbar")).toBeVisible();
  await expect(page.getByTestId("list-tag-filter").locator('option[value=""]')).toHaveText(
    "Все теги",
  );

  const search = await page.getByTestId("list-search").boundingBox();
  const tags = await page.getByTestId("list-tag-filter").boundingBox();
  const status = await page.getByTestId("list-status-filter").boundingBox();
  const sort = await page.getByTestId("list-sort-filter").boundingBox();
  expect(search && tags && status && sort).toBeTruthy();
  const tops = [search!.y, tags!.y, status!.y, sort!.y];
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
});

test("e2e_list_rows_aligned", async ({ page }) => {
  const login = uniqueLogin("m82align");
  await registerUi(page, login);
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    await apiCreateNote(page.request, {
      title: `Align ${i} ${now}`,
      body: `body line ${i}`,
      starts_at: new Date(Date.now() + (i + 1) * 3600_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
      reminder_offsets: i % 2 === 0 ? [10] : [],
      tag_ids: [],
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/list");
  const titles = page.getByTestId("list-note-title");
  await expect(titles.first()).toBeVisible();
  const count = await titles.count();
  expect(count).toBeGreaterThanOrEqual(2);
  const xs: number[] = [];
  for (let i = 0; i < count; i++) {
    const box = await titles.nth(i).boundingBox();
    expect(box).toBeTruthy();
    xs.push(box!.x);
  }
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1);
});

test("m8_2_screenshots_1440_and_1024", async ({ page }) => {
  const login = uniqueLogin("m82shot");
  await registerUi(page, login);
  await page.request.patch("/api/me", {
    data: { timezone: "UTC", email: "m82shot@example.com" },
  });
  const tagRes = await page.request.post("/api/tags", {
    data: { name: "Работа", color: "#3E6FB0" },
  });
  const tag = await tagRes.json();
  await apiCreateNote(page.request, {
    title: "Созвон с командой",
    body: "длинный текст заметки для списка",
    starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [10],
    tag_ids: [tag.id],
  });

  for (const width of [1440, 1024] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/list");
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT, `list-${width}.png`),
      fullPage: true,
    });
    await page.goto("/notes/new");
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT, `note-new-${width}.png`),
      fullPage: true,
    });
  }
});
