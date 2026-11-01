import { expect, type Page, test } from "@playwright/test";
import { registerUi, uniqueLogin } from "./helpers";

const YT_URL = "https://youtu.be/dQw4w9WgXcQ";
const JOB_A = "00000000-0000-4000-8000-0000000000a1";
const JOB_B = "00000000-0000-4000-8000-0000000000b2";

const RESULT = {
  summary: {
    title: "M14 late summary",
    body: "## Main idea\nLate response wins only if current.",
    starts_at: null,
    reminder_offsets: [],
    tag_names: [],
    kind: "summary",
  },
  summary_ru: null,
  drafts: [],
  provider: "stub",
  transcript: "hello",
  source_lang: "en",
};

async function stubYtPlayer(page: Page) {
  await page.route(/youtube\.com\/iframe_api/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.YT = { Player: function () { this.destroy = function () {}; } };
        if (typeof window.onYouTubeIframeAPIReady === "function") window.onYouTubeIframeAPIReady();
      `,
    });
  });
}

test("e2e_youtube_double_click_single_job", async ({ page }) => {
  const login = uniqueLogin("m14dbl");
  let starts = 0;
  await stubYtPlayer(page);
  await page.route("**/api/extract/youtube/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    starts += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: JOB_A,
        status: "pending",
        step: "queued",
        video_id: "dQw4w9WgXcQ",
        reused: starts > 1,
      }),
    });
  });
  await page.route(`**/api/extract/jobs/${JOB_A}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: JOB_A,
        status: "done",
        step: "done",
        video_id: "dQw4w9WgXcQ",
        error_code: null,
        error_message: null,
        error_hint: null,
        result: RESULT,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
        finished_at: "2026-11-01T00:00:00Z",
      }),
    });
  });

  await registerUi(page, login);
  await page.getByTestId("nav-video").click();
  await page.getByTestId("video-url-input").fill(YT_URL);
  await page.getByTestId("video-open").click();
  const btn = page.getByTestId("video-extract-captions");
  await btn.click();
  await btn.click({ force: true }); // second click while busy should be ignored
  await expect(page.getByTestId("video-drafts-modal")).toBeVisible({ timeout: 15_000 });
  expect(starts).toBe(1);
});

test("e2e_youtube_late_response_ignored_after_cancel", async ({ page }) => {
  const login = uniqueLogin("m14late");
  let resolvePoll: ((v: unknown) => void) | null = null;
  const gate = new Promise((r) => {
    resolvePoll = r;
  });

  await stubYtPlayer(page);
  await page.route("**/api/extract/youtube/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: JOB_B,
        status: "running",
        step: "captions",
        video_id: "dQw4w9WgXcQ",
        reused: false,
      }),
    });
  });
  await page.route(`**/api/extract/jobs/${JOB_B}/cancel`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: JOB_B,
        status: "cancelled",
        step: "captions",
        video_id: "dQw4w9WgXcQ",
        error_code: "cancelled",
        error_message: "Разбор отменён.",
        error_hint: "hint",
        result: null,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
        finished_at: "2026-11-01T00:00:00Z",
      }),
    });
  });
  await page.route(`**/api/extract/jobs/${JOB_B}`, async (route) => {
    if (route.request().method() === "POST") return route.continue();
    await gate; // hold poll until after cancel
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: JOB_B,
        status: "done",
        step: "done",
        video_id: "dQw4w9WgXcQ",
        error_code: null,
        error_message: null,
        error_hint: null,
        result: { ...RESULT, summary: { ...RESULT.summary, title: "SHOULD NOT APPEAR" } },
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
        finished_at: "2026-11-01T00:00:00Z",
      }),
    });
  });

  await registerUi(page, login);
  await page.getByTestId("nav-video").click();
  await page.getByTestId("video-url-input").fill(YT_URL);
  await page.getByTestId("video-open").click();
  await page.getByTestId("video-extract-captions").click();
  await expect(page.getByTestId("video-extract-cancel")).toBeVisible();
  await page.getByTestId("video-extract-cancel").click();
  await expect(page.getByTestId("video-extract-error")).toContainText(/отмен/i);
  resolvePoll?.(true);
  await page.waitForTimeout(800);
  await expect(page.getByTestId("video-drafts-modal")).toHaveCount(0);
  await expect(page.getByText("SHOULD NOT APPEAR")).toHaveCount(0);
});
