import { expect, type Page, test } from "@playwright/test";
import {
  apiCreateNote,
  apiRegister,
  loginUi,
  registerUi,
  uniqueLogin,
  waitForWsReady,
} from "./helpers";
import {
  InvalidateCoalescer,
  queryKeysForRealtimeEvent,
  WS_INVALIDATE_COALESCE_MS,
} from "../src/realtime";

test("test_ws_invalidate_coalesce", async () => {
  const flushed: unknown[][] = [];
  const timers: Array<{ cb: () => void; ms: number }> = [];
  const schedule = ((cb: () => void, ms?: number) => {
    const id = timers.length + 1;
    timers.push({ cb, ms: ms ?? 0 });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const cancel = ((_id: ReturnType<typeof setTimeout>) => {
    /* ignore — tests fire manually */
  }) as typeof clearTimeout;

  const c = new InvalidateCoalescer(
    (keys) => {
      flushed.push(keys as unknown[]);
    },
    WS_INVALIDATE_COALESCE_MS,
    schedule,
    cancel,
  );

  for (let i = 0; i < 20; i++) {
    c.enqueue(
      queryKeysForRealtimeEvent({
        type: "note.changed",
        ids: [`id-${i % 3}`],
      }),
    );
  }
  expect(c.getFlushCount()).toBe(0);
  expect(timers.length).toBeGreaterThan(0);
  // Run last scheduled flush only (previous cancelled).
  timers[timers.length - 1]!.cb();
  expect(c.getFlushCount()).toBe(1);
  // Unique keys: notes/calendar/upcoming/trash + up to 3 note ids
  expect(flushed[0]!.length).toBeLessThanOrEqual(7);
  expect(flushed[0]!.length).toBeGreaterThanOrEqual(4);
  c.dispose();
});

test("e2e_shared_note_personal_tags", async ({ browser }) => {
  const ownerLogin = uniqueLogin("m16o");
  const memberLogin = uniqueLogin("m16m");
  const title = `M16 shared ${Date.now().toString(36)}`;

  const ownerCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  const memberPage = await memberCtx.newPage();

  try {
    await apiRegister(ownerCtx.request, ownerLogin);
    await apiRegister(memberCtx.request, memberLogin);

    const ownerTagRes = await ownerCtx.request.post("/api/tags", {
      data: { name: "owner-m16", color: "#2563EB" },
    });
    expect(ownerTagRes.ok(), await ownerTagRes.text()).toBeTruthy();
    const ownerTag = await ownerTagRes.json();

    const memberTagRes = await memberCtx.request.post("/api/tags", {
      data: { name: "member-m16", color: "#16A34A" },
    });
    expect(memberTagRes.ok(), await memberTagRes.text()).toBeTruthy();
    const memberTag = await memberTagRes.json();

    const note = await apiCreateNote(ownerCtx.request, {
      title,
      body: "shared",
      starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      reminder_offsets: [],
      tag_ids: [ownerTag.id],
    });

    await loginUi(ownerPage, ownerLogin);
    await loginUi(memberPage, memberLogin);
    await waitForWsReady(ownerPage);
    await waitForWsReady(memberPage);

    await ownerPage.goto(`/notes/${note.id}`);
    await expect(ownerPage.getByTestId("note-selected-tags")).toContainText("owner-m16");
    await ownerPage.getByTestId("share-login").fill(memberLogin);
    await ownerPage.getByTestId("share-add").click();
    await expect(ownerPage.getByTestId("share-members")).toContainText(memberLogin, {
      timeout: 10_000,
    });

    await memberPage.goto(`/notes/${note.id}`);
    await expect(memberPage.getByTestId("note-form")).toBeVisible();
    // Owner tags must not appear as selected for the member.
    await expect(memberPage.getByTestId("note-selected-tags")).toHaveCount(0);

    await memberPage.getByTestId("meta-tags").click();
    await memberPage.getByTestId(`tag-multi-option-${memberTag.id}`).click();
    await expect(memberPage.getByTestId("note-save-status")).toContainText("Сохранено", {
      timeout: 10_000,
    });
    await expect(memberPage.getByTestId("note-selected-tags")).toContainText("member-m16");

    await ownerPage.reload();
    await expect(ownerPage.getByTestId("note-selected-tags")).toContainText("owner-m16");
    await expect(ownerPage.getByTestId("note-selected-tags")).not.toContainText("member-m16");
  } finally {
    await ownerCtx.close();
    await memberCtx.close();
  }
});

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

async function stubExtractJob(page: Page, title: string): Promise<void> {
  const jobId = "00000000-0000-4000-8000-000000000016";
  const payload = {
    summary: {
      title,
      body: "## Main idea\nCalendar hide test.\n\n## Notes\n- one",
      starts_at: "2026-11-02T15:00:00Z",
      reminder_offsets: [],
      tag_names: [],
      kind: "summary",
    },
    drafts: [],
    provider: "stub",
    transcript: "hello",
    source_lang: "en",
    summary_ru: null,
  };
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
        created_at: "2026-11-02T00:00:00Z",
        updated_at: "2026-11-02T00:00:00Z",
        finished_at: "2026-11-02T00:00:00Z",
      }),
    });
  });
}

test("e2e_video_draft_show_in_calendar_checkbox", async ({ page }) => {
  const login = uniqueLogin("m16vid");
  const title = `M16 video cal ${Date.now().toString(36)}`;
  await stubYouTubeIframeApi(page);
  await stubExtractJob(page, title);

  await registerUi(page, login);

  await page.getByTestId("nav-video").click();
  await expect(page.getByTestId("video-notes-page")).toBeVisible();
  await page.getByTestId("video-url-input").fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByTestId("video-open").click();
  await page.getByTestId("video-extract-captions").click();

  await expect(page.getByTestId("video-drafts-modal")).toBeVisible({ timeout: 15_000 });
  const calBox = page.getByTestId("extract-show-in-calendar").locator('input[type="checkbox"]');
  await expect(calBox).not.toBeChecked();

  await page.getByTestId("extract-confirm-drafts").click();
  await expect(page.getByTestId("video-drafts-modal")).toHaveCount(0);

  // List has the note
  await page.goto("/list");
  await expect(page.getByTestId("list-note-title").filter({ hasText: title })).toBeVisible({
    timeout: 10_000,
  });

  // Calendar API must omit it
  const cal = await page.request.get(
    "/api/calendar?from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z",
  );
  expect(cal.ok()).toBeTruthy();
  const items = (await cal.json()).items as Array<{ note: { title: string } }>;
  expect(items.some((o) => o.note.title === title)).toBeFalsy();
});
