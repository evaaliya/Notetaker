import { expect, test } from "@playwright/test";
import { registerUi, uniqueLogin } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("e2e_autosave_empty_new_creates_nothing", async ({ page }) => {
  const login = uniqueLogin("asempty");
  await registerUi(page, login);
  await page.goto("/notes/new");
  await expect(page.getByTestId("note-form")).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page).toHaveURL(/\/notes\/new$/);
  const list = await page.request.get("/api/notes");
  expect(list.ok()).toBeTruthy();
  const body = (await list.json()) as { items: unknown[] };
  expect(body.items.length).toBe(0);
});

test("e2e_autosave_first_char_creates_note", async ({ page }) => {
  const login = uniqueLogin("aschar");
  await registerUi(page, login);
  await page.goto("/notes/new");
  await page.getByTestId("note-title").fill("Autosave title");
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/i, { timeout: 10_000 });
  await expect(page.getByTestId("note-save-status")).toContainText(/Сохран/);
  await page.goto("/list");
  await expect(page.getByText("Autosave title")).toBeVisible();
});

test("e2e_autosave_pending_file_creates_and_uploads", async ({ page }) => {
  const login = uniqueLogin("asfile");
  await registerUi(page, login);
  await page.goto("/notes/new");
  await page.getByTestId("meta-attachments-trigger").click();
  await page.getByTestId("note-attach-file-input").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByTestId("attachment-pending")).toBeVisible();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/i, { timeout: 15_000 });
  // Keep attachments section open after navigate-replace to /notes/:id
  if ((await page.getByTestId("meta-attachments").getAttribute("data-open")) !== "1") {
    await page.getByTestId("meta-attachments-trigger").click();
  }
  await expect(page.getByTestId("attachment-thumb")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("attachment-pending")).toHaveCount(0);
});

test("e2e_autosave_draft_survives_reload_via_idb", async ({ page }) => {
  const login = uniqueLogin("asidb");
  await registerUi(page, login);
  await page.goto("/notes/new");
  await expect(page.getByTestId("note-form")).toBeVisible();

  // Seed IndexedDB directly (avoids race with 600ms server create clearing the draft).
  const startsLocal = await page.getByTestId("note-starts").inputValue();
  await page.evaluate(
    async ({ body, startsLocal: starts }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("notetaker-drafts", 1);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("drafts")) {
            db.createObjectStore("drafts", { keyPath: "key" });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put({
            key: "new",
            title: "",
            body,
            startsLocal: starts,
            tagIds: [],
            reminderOffsets: [],
            recurrence: null,
            files: [],
            updatedAt: Date.now(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { body: "Черновик в IndexedDB", startsLocal },
  );

  const seeded = await page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const req = indexedDB.open("notetaker-drafts", 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("drafts", "readonly");
          const get = tx.objectStore("drafts").get("new");
          get.onsuccess = () => {
            resolve((get.result as { body?: string } | undefined)?.body ?? null);
            db.close();
          };
          get.onerror = () => reject(get.error);
        };
      }),
  );
  expect(seeded).toBe("Черновик в IndexedDB");

  // Full navigation remounts the editor and reloads the draft from IDB.
  await page.goto("/list");
  await page.goto("/notes/new");
  await expect(page.getByTestId("note-body")).toHaveValue("Черновик в IndexedDB", {
    timeout: 10_000,
  });
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/i, { timeout: 10_000 });
});
