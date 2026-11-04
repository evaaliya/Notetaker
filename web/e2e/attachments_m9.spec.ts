import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

/** Minimal 1×1 PNG */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("e2e_attachment_image_thumbnail", async ({ page }) => {
  const login = uniqueLogin("m9att");
  await registerUi(page, login);

  const note = await apiCreateNote(page.request, {
    title: "M9 Attach UI",
    body: "",
    starts_at: "2026-10-31T15:00:00Z",
    tag_ids: [],
    reminder_offsets: [],
  });

  await page.goto(`/notes/${note.id}`);
  await expect(page.getByTestId("note-attach-btn")).toBeVisible();

  await page.getByTestId("note-attach-file-input").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  await expect(page.getByTestId("attachment-thumb")).toBeVisible({ timeout: 15_000 });
  const img = page.getByTestId("attachment-thumb").locator("img");
  await expect(img).toHaveAttribute("src", new RegExp(`/api/notes/${note.id}/attachments/`));
  // Image actually painted (naturalWidth > 0).
  await expect
    .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  await page.goto("/list");
  await expect(page.getByTestId("note-has-attachments").first()).toBeVisible();
});

test("e2e_attachment_delete_uses_btn_danger", async ({ page }) => {
  const login = uniqueLogin("m9del");
  await registerUi(page, login);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notes/new");
  await page.getByTestId("note-attach-file-input").setInputFiles({
    name: "pending.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  const pending = page.getByTestId("attachment-pending");
  await expect(pending).toBeVisible();
  await expect(pending.getByText("Ожидает сохранения")).toBeVisible();
  const del = pending.getByTestId("attachment-delete-pending");
  await expect(del).toBeVisible();
  await expect(del).toHaveClass(/btn-danger/);
  // Contrast: solid danger background, not accent teal + red text.
  const colors = await del.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color };
  });
  expect(colors.bg).not.toMatch(/^rgb\(0,\s*0,\s*0\)$/);
  // btn-danger uses white text on danger fill (AA).
  expect(colors.color).toMatch(/rgb\(\s*255,\s*255,\s*255\s*\)/);
  const box = await del.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.height).toBeGreaterThanOrEqual(40);
});
