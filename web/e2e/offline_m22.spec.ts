import { expect, test, type Page } from "@playwright/test";
import { registerUi, uniqueLogin } from "./helpers";

async function countNotes(page: Page): Promise<number> {
  const res = await page.request.get("/api/notes?limit=100");
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = (await res.json()) as { items: unknown[] };
  return body.items.length;
}

test("e2e_offline_create_queued_once", async ({ page, context }) => {
  const login = uniqueLogin("m22q");
  await registerUi(page, login);
  await page.goto("/notes/new");
  await expect(page.getByTestId("note-form")).toBeVisible();

  await context.setOffline(true);
  await page.getByTestId("note-title").fill("M22 queued once");
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/notes\/new$/);
  await page.waitForTimeout(1500);
  expect(await countNotes(page)).toBe(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(async () => countNotes(page), { timeout: 20_000 })
    .toBe(1);
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/i, { timeout: 20_000 });
  await expect(page.getByTestId("note-save-status")).toContainText(/Сохран/);
  // Second online flush must not duplicate.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(2000);
  expect(await countNotes(page)).toBe(1);
});

test("e2e_offline_note_page_shows_network_error", async ({ page }) => {
  const login = uniqueLogin("m22net");
  await registerUi(page, login);
  const created = await page.request.post("/api/notes", {
    data: {
      title: "M22 net",
      body: "",
      starts_at: new Date().toISOString(),
      tag_ids: [],
      reminder_offsets: [],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const note = (await created.json()) as { id: string };

  await page.route(`**/api/notes/${note.id}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto(`/notes/${note.id}`);
  await expect(page.getByTestId("note-network-error")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("note-network-retry")).toBeVisible();
  await expect(page.getByText("Заметка не найдена")).toHaveCount(0);

  await page.unroute(`**/api/notes/${note.id}`);
  await page.getByTestId("note-network-retry").click();
  await expect(page.getByTestId("note-title")).toHaveValue("M22 net", { timeout: 10_000 });
});

test("e2e_no_duplicate_after_reconnect", async ({ page }) => {
  const login = uniqueLogin("m22dup");
  await registerUi(page, login);
  await page.goto("/notes/new");
  await expect(page.getByTestId("note-form")).toBeVisible();

  // Keep aborting until we open the gate — otherwise outbox flush wins the race
  // and the banner never appears.
  let dropResponses = true;
  await page.route("**/api/notes", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    if (dropResponses) {
      await route.fetch();
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.getByTestId("note-title").fill("M22 no dup");
  await expect(page).toHaveURL(/\/notes\/new$/);
  await expect
    .poll(async () => countNotes(page), { timeout: 10_000 })
    .toBe(1);
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 8_000 });

  dropResponses = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  // Idempotent create: still exactly one note; navigate to that id.
  await expect
    .poll(async () => countNotes(page), { timeout: 20_000 })
    .toBe(1);
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/i, { timeout: 20_000 });
  await expect(page.getByTestId("note-save-status")).toContainText(/Сохран/);
  await page.waitForTimeout(1500);
  expect(await countNotes(page)).toBe(1);
});
