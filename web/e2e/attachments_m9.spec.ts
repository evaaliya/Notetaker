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
  await page.getByTestId("meta-attachments-trigger").click();
  await expect(page.getByTestId("note-attachments-slot")).toBeVisible();

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
