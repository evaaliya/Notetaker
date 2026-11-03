import { expect, type Page, test } from "@playwright/test";
import { registerUi, uniqueLogin } from "./helpers";

const YT_URL = "https://youtu.be/dQw4w9WgXcQ";

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

test("e2e_m21_openrouter_missing_key_message_fast", async ({ page }) => {
  const login = uniqueLogin("m21nokey");
  await stubYtPlayer(page);

  await page.route("**/api/extract/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "openrouter",
        configured: false,
        worker_ok: true,
      }),
    });
  });

  let jobPosts = 0;
  await page.route("**/api/extract/youtube/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    jobPosts += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "missing_ai_key",
          message:
            "Не задан ключ ИИ-провайдера: добавьте OPENROUTER_API_KEY в .env или поставьте AI_PROVIDER=stub",
          hint: "В .env укажите ключ или AI_PROVIDER=stub",
        },
      }),
    });
  });

  await registerUi(page, login);
  await page.getByTestId("nav-video").click();

  // Warning near the button from config preflight
  await expect(page.getByTestId("video-extract-config-warn")).toContainText(
    "Не задан ключ ИИ-провайдера",
    { timeout: 5_000 },
  );

  await page.getByTestId("video-url-input").fill(YT_URL);
  await page.getByTestId("video-open").click();

  const t0 = Date.now();
  await page.getByTestId("video-extract-captions").click();
  await expect(page.getByTestId("video-extract-error")).toContainText(
    "Не задан ключ ИИ-провайдера",
    { timeout: 2_000 },
  );
  expect(Date.now() - t0).toBeLessThanOrEqual(2_000);
  // Preflight stops before POST, or POST returns instantly — either way ≤2s and no hang.
  expect(jobPosts).toBeLessThanOrEqual(1);
});

test("e2e_m21_worker_down_error_within_20s", async ({ page }) => {
  const login = uniqueLogin("m21noworker");
  const jobId = "00000000-0000-4000-8000-0000000000d1";
  await stubYtPlayer(page);

  let workerOk = true;
  await page.route("**/api/extract/config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "stub",
        configured: true,
        worker_ok: workerOk,
      }),
    });
  });

  await page.route("**/api/extract/youtube/jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    // After the job is accepted, simulate a dead worker for subsequent config polls.
    workerOk = false;
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: jobId,
        status: "pending",
        step: "queued",
        video_id: "dQw4w9WgXcQ",
        error_code: null,
        error_message: null,
        error_hint: null,
        result: null,
        created_at: "2026-11-01T00:00:00Z",
        updated_at: "2026-11-01T00:00:00Z",
        finished_at: null,
      }),
    });
  });

  await registerUi(page, login);
  await page.getByTestId("nav-video").click();
  await page.getByTestId("video-url-input").fill(YT_URL);
  await page.getByTestId("video-open").click();

  const t0 = Date.now();
  await page.getByTestId("video-extract-captions").click();
  await expect(page.getByTestId("video-extract-error")).toContainText(
    "Фоновый обработчик не отвечает",
    { timeout: 20_000 },
  );
  expect(Date.now() - t0).toBeLessThanOrEqual(20_000);
});
