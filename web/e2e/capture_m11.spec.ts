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

  const extractResp = page.waitForResponse(
    (r) => r.url().includes("/api/extract") && r.request().method() === "POST",
  );
  await page.getByTestId("call-extract").click();

  // Thinking panel may flash on fast stub; wait for API then durable modal.
  await expect(
    page.getByTestId("call-ai-thinking").or(page.getByTestId("call-drafts-modal")),
  ).toBeVisible();
  const resp = await extractResp;
  expect(resp.ok(), await resp.text()).toBeTruthy();
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

test("e2e_video_player_in_extract_panel", async ({ page }) => {
  const login = uniqueLogin("m11vid");
  await registerUi(page, login);

  await page.getByTestId("nav-video").click();
  await expect(page.getByTestId("video-notes-page")).toBeVisible();

  const origin = new URL(page.url()).origin;
  await page.getByTestId("video-url-input").fill(`${origin}/m11-sample.mp4`);
  await page.getByTestId("video-open").click();

  const native = page.getByTestId("video-native");
  await expect(native).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("video-captions-extract").getByTestId("video-native")).toBeVisible();
  await expect(page.getByTestId("video-note-at-time")).toHaveCount(0);
});
