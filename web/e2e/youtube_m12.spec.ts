import { expect, type Page, test } from "@playwright/test";
import { registerUi, uniqueLogin } from "./helpers";

const YT_URL = "https://youtu.be/dQw4w9WgXcQ";

const EN_SUMMARY = {
  title: "Notes: M12 English summary",
  body: "## Main idea\nEnglish notes from captions.\n\n## Notes\n- Point one",
  starts_at: null as string | null,
  reminder_offsets: [] as number[],
  tag_names: ["notes"],
  kind: "summary" as const,
};

const RU_SUMMARY = {
  title: "[RU] Notes: M12 English summary",
  body: "## Главная мысль\nРусский перевод конспекта.\n\n## Заметки\n- Пункт один",
  starts_at: null as string | null,
  reminder_offsets: [] as number[],
  tag_names: ["notes"],
  kind: "summary" as const,
};

const RU_ONLY_SUMMARY = {
  title: "Конспект: M12 русский источник",
  body: "## Главная мысль\nТолько русский конспект.\n\n## Заметки\n- Без перевода",
  starts_at: null as string | null,
  reminder_offsets: [] as number[],
  tag_names: ["конспект"],
  kind: "summary" as const,
};

async function stubYouTubeIframeApi(page: Page): Promise<void> {
  await page.route(/youtube\.com\/iframe_api/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.YT = window.YT || {};
        window.YT.Player = function (el, opts) {
          this.destroy = function () {};
          if (opts && opts.events && typeof opts.events.onReady === "function") {
            opts.events.onReady();
          }
        };
        if (typeof window.onYouTubeIframeAPIReady === "function") {
          window.onYouTubeIframeAPIReady();
        }
      `,
    });
  });
}

async function stubExtractYoutube(
  page: Page,
  payload: Record<string, unknown>,
): Promise<void> {
  const jobId = "00000000-0000-4000-8000-000000000012";
  // M14 UI uses job start + poll; keep sync route for compat.
  await page.route("**/api/extract/youtube/jobs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: jobId,
        status: "pending",
        step: "queued",
        video_id: "dQw4w9WgXcQ",
        reused: false,
      }),
    });
  });
  await page.route(`**/api/extract/jobs/${jobId}`, async (route) => {
    if (route.request().method() === "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: jobId,
        status: "done",
        step: "done",
        video_id: "dQw4w9WgXcQ",
        error_code: null,
        error_message: null,
        error_hint: null,
        result: payload,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
        finished_at: "2026-11-01T00:00:00Z",
      }),
    });
  });
  await page.route("**/api/extract/youtube", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

async function openVideoAndExtract(page: Page, url = YT_URL): Promise<void> {
  await page.getByTestId("nav-video").click();
  await expect(page.getByTestId("video-notes-page")).toBeVisible();
  await page.getByTestId("video-url-input").fill(url);
  await page.getByTestId("video-open").click();
  await page.getByTestId("video-extract-captions").click();
  await expect(page.getByTestId("video-drafts-modal")).toBeVisible({ timeout: 15_000 });
}

test("e2e_youtube_save_english_summary", async ({ page }) => {
  const login = uniqueLogin("yt_en");
  await stubYouTubeIframeApi(page);
  await stubExtractYoutube(page, {
    summary: EN_SUMMARY,
    summary_ru: RU_SUMMARY,
    drafts: [],
    provider: "stub",
    transcript: "A lifelong Democrat explains why she voted for change.",
    source_lang: "en",
  });
  await registerUi(page, login);
  await openVideoAndExtract(page);

  const lang = page.getByTestId("extract-summary-lang");
  await expect(lang).toBeVisible();
  await lang.getByLabel("English (оригинал)").check();
  await expect(page.getByTestId("extract-draft-list")).toContainText(EN_SUMMARY.title);

  await page.getByTestId("extract-confirm-drafts").click();
  await expect(page.getByTestId("video-drafts-modal")).toHaveCount(0);

  const list = page.getByTestId("video-note-list");
  await expect(list).toBeVisible();
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list).toContainText(EN_SUMMARY.title);
  await expect(list).toContainText("создано ИИ");
  await expect(list).not.toContainText(RU_SUMMARY.title);
});

test("e2e_youtube_save_russian_translation", async ({ page }) => {
  const login = uniqueLogin("yt_ru");
  await stubYouTubeIframeApi(page);
  await stubExtractYoutube(page, {
    summary: EN_SUMMARY,
    summary_ru: RU_SUMMARY,
    drafts: [],
    provider: "stub",
    transcript: "A lifelong Democrat explains why she voted for change.",
    source_lang: "en",
  });
  await registerUi(page, login);
  await openVideoAndExtract(page);

  const lang = page.getByTestId("extract-summary-lang");
  await expect(lang).toBeVisible();
  await lang.getByLabel("Русский (перевод)").check();
  await expect(page.getByTestId("extract-draft-list")).toContainText(RU_SUMMARY.title);

  await page.getByTestId("extract-confirm-drafts").click();
  await expect(page.getByTestId("video-drafts-modal")).toHaveCount(0);

  const list = page.getByTestId("video-note-list");
  await expect(list).toBeVisible();
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list).toContainText(RU_SUMMARY.title);
  await expect(list).toContainText("создано ИИ");
  await expect(list.locator("li").first()).toContainText("[RU]");
});

test("e2e_youtube_russian_source_no_lang_choice", async ({ page }) => {
  const login = uniqueLogin("yt_ruonly");
  await stubYouTubeIframeApi(page);
  await stubExtractYoutube(page, {
    summary: RU_ONLY_SUMMARY,
    summary_ru: null,
    drafts: [],
    provider: "stub",
    transcript: "Участники обсуждают релиз. Задача подготовить конспект.",
    source_lang: "ru",
  });
  await registerUi(page, login);
  await openVideoAndExtract(page);

  await expect(page.getByTestId("extract-summary-lang")).toHaveCount(0);
  await expect(page.getByTestId("extract-draft-list")).toContainText(RU_ONLY_SUMMARY.title);

  await page.getByTestId("extract-confirm-drafts").click();
  await expect(page.getByTestId("video-drafts-modal")).toHaveCount(0);

  const list = page.getByTestId("video-note-list");
  await expect(list).toBeVisible();
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list).toContainText(RU_ONLY_SUMMARY.title);
  await expect(list).toContainText("создано ИИ");
});
