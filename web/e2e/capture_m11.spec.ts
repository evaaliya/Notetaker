import { expect, test } from "@playwright/test";
import { registerUi, uniqueLogin } from "./helpers";

test("e2e_call_transcript_extract", async ({ page }) => {
  const login = uniqueLogin("m11call");
  await registerUi(page, login);

  await page.getByTestId("nav-call").click();
  await expect(page.getByTestId("call-capture-page")).toBeVisible();

  const transcript =
    "Участники: Аня, Боря\nЗадача: подготовить отчёт завтра в 15:00\nРешили: переносим релиз на пятницу";
  await page.getByTestId("call-transcript-text").fill(transcript);
  await page.getByTestId("call-extract").click();

  await expect(page.getByTestId("call-drafts-modal")).toBeVisible();
  await expect(page.getByTestId("call-draft-list")).toContainText("создано ИИ");
  await page.getByTestId("call-confirm-drafts").click();

  await expect(page).toHaveURL(/\/list/);
  await expect(page.getByText(/отчёт|Конспект|релиз/i).first()).toBeVisible({ timeout: 10_000 });
});

test("e2e_video_captions_button_visible", async ({ page }) => {
  const login = uniqueLogin("m11cap");
  await registerUi(page, login);
  await page.getByTestId("nav-video").click();
  await expect(page.getByTestId("video-extract-captions")).toBeVisible();
  await page.getByTestId("video-url-input").fill("https://youtu.be/dQw4w9WgXcQ");
  await expect(page.getByTestId("video-extract-captions")).toBeEnabled();
});

test("e2e_video_note_at_timestamp", async ({ page }) => {
  const login = uniqueLogin("m11vid");
  await registerUi(page, login);

  await page.getByTestId("nav-video").click();
  await expect(page.getByTestId("video-notes-page")).toBeVisible();

  // Local fixture in web/public (no external network / mic).
  const origin = new URL(page.url()).origin;
  await page.getByTestId("video-url-input").fill(`${origin}/m11-sample.mp4`);
  await page.getByTestId("video-open").click();

  const native = page.getByTestId("video-native");
  await expect(native).toBeVisible({ timeout: 15_000 });
  await native.evaluate(async (el) => {
    const v = el as HTMLVideoElement;
    await v.play().catch(() => undefined);
    v.pause();
    v.currentTime = 3;
  });

  await page.getByTestId("video-note-title").fill("Кадр цветка");
  await page.getByTestId("video-note-body").fill("Заметка без микрофона");
  await page.getByTestId("video-note-at-time").click();

  await expect(page.getByTestId("video-note-list")).toContainText("Кадр цветка");
  await expect(page.getByTestId("video-timecode").first()).toBeVisible();

  // Click timecode seeks (no mic involved).
  await page.getByTestId("video-timecode").first().click();
  const t = await page.evaluate(() => {
    const v = document.querySelector('[data-testid="video-native"]') as HTMLVideoElement | null;
    return v?.currentTime ?? -1;
  });
  expect(t).toBeGreaterThanOrEqual(2);
});
