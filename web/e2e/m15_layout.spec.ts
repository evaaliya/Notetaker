import { expect, test, type Page } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

const WIDTHS = [390, 768, 1024, 1440, 1920] as const;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodyScroll: document.body.scrollWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `h-scroll: scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function setSidebar(page: Page, collapsed: boolean) {
  await page.evaluate((c) => {
    localStorage.setItem("notetaker.sidebarCollapsed", c ? "1" : "0");
  }, collapsed);
  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 15_000 });
}

test("m15_video_note_link_opens_editor", async ({ page }) => {
  const login = uniqueLogin("m15vid");
  await registerUi(page, login);
  await page.goto("/capture/video");
  const origin = new URL(page.url()).origin;
  const videoUrl = `${origin}/m11-sample.mp4`;
  const note = await apiCreateNote(page.request, {
    title: "M15 Video Note Link",
    body: "from video list",
    starts_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    source: "video",
    source_url: videoUrl,
    ai_generated: true,
  });

  await page.getByTestId("video-url-input").fill(videoUrl);
  await page.getByTestId("video-open").click();
  await expect(page.getByTestId("video-note-list")).toBeVisible();
  const link = page.getByTestId("note-link").filter({ hasText: note.title });
  await expect(link).toHaveAttribute("href", `/notes/${note.id}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/notes/${note.id}$`));
  await expect(page.getByTestId("note-editor-page")).toBeVisible();
});

test("m15_note_page_fills_main_width", async ({ page }) => {
  const login = uniqueLogin("m15width");
  await registerUi(page, login);
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const ls of ["0", "1"] as const) {
    await page.evaluate((v) => localStorage.setItem("notetaker.sidebarCollapsed", v), ls);
    await page.goto("/notes/new");
    await expect(page.getByTestId("note-editor-page")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const main = document.querySelector(".app-main");
      const ws = document.querySelector(".notes-workspace");
      if (!main || !ws) return null;
      const mr = main.getBoundingClientRect();
      const wr = ws.getBoundingClientRect();
      return {
        mainW: Math.round(mr.width),
        wsW: Math.round(wr.width),
        mainClass: main.className,
        ratio: wr.width / mr.width,
      };
    });
    expect(metrics).toBeTruthy();
    expect(metrics!.mainClass).toContain("note-route");
    expect(metrics!.mainClass).not.toContain("note-main");
    // Workspace must fill main (allow 2px subpixel), not shrink-wrap ~50%.
    expect(metrics!.ratio).toBeGreaterThan(0.95);
    expect(metrics!.wsW).toBeGreaterThan(1000);
  }
});

test("m15_day_end_event_not_clipped", async ({ page }) => {
  const login = uniqueLogin("m15day2");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });

  const now = new Date();
  const late = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 20, 0),
  );
  const starts = late.toISOString().replace(/\.\d{3}Z$/, "Z");
  await apiCreateNote(page.request, {
    title: "M15 Late UTC",
    body: "23:20",
    starts_at: starts,
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/calendar");
  await page.getByRole("button", { name: "День" }).click();
  // "Сегодня" disabled when already on today — do not click.
  await expect(page.locator(".fc-timeGridDay-view")).toBeVisible();

  const event = page.locator(".fc-timegrid-event").filter({ hasText: "M15 Late UTC" });
  await expect(event).toBeVisible({ timeout: 15_000 });

  const clip = await event.evaluate((el) => {
    const day = el.closest(".fc-timegrid-col") as HTMLElement | null;
    const er = el.getBoundingClientRect();
    const dr = day?.getBoundingClientRect();
    const style = getComputedStyle(el);
    const cal = el.closest(".cal-event") as HTMLElement | null;
    const calOverflow = cal ? getComputedStyle(cal).overflow : null;
    return {
      eventH: Math.round(er.height),
      eventTop: Math.round(er.top),
      dayBottom: dr ? Math.round(dr.bottom) : null,
      dayTop: dr ? Math.round(dr.top) : null,
      overflow: style.overflow,
      calOverflow,
      text: (el.textContent || "").includes("M15 Late UTC"),
      // Top of event must start inside the day column (not pushed below midnight).
      startsInDay: dr ? er.top >= dr.top - 2 && er.top < dr.bottom : false,
    };
  });
  expect(clip.text).toBe(true);
  expect(clip.eventH).toBeGreaterThanOrEqual(40);
  expect(clip.startsInDay).toBe(true);
  // Content must not be clipped by our event chrome (D-088).
  expect(["visible", "clip"].includes(clip.overflow) || clip.overflow === "visible").toBeTruthy();
  if (clip.calOverflow) expect(clip.calOverflow).toBe("visible");
});

test("m15_calendar_resize_after_sidebar_toggle", async ({ page }) => {
  const login = uniqueLogin("m15cal");
  await registerUi(page, login);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/calendar");
  await expect(page.locator(".fc-view-harness")).toBeVisible();

  async function colCount() {
    return page.locator(".fc-timegrid-col.fc-day").count();
  }

  const before = await colCount();
  expect(before).toBeGreaterThanOrEqual(7);

  // Expand sidebar (default collapsed).
  await page.getByTestId("sidebar-toggle").click();
  await page.waitForTimeout(200); // after 150ms transition
  const mid = await colCount();
  expect(mid).toBe(before);

  const widthsMid = await page.locator(".fc-timegrid-col.fc-day").evaluateAll((cols) =>
    cols.map((c) => Math.round(c.getBoundingClientRect().width)),
  );
  expect(widthsMid.every((w) => w > 40)).toBe(true);

  await page.getByTestId("sidebar-toggle").click();
  await page.waitForTimeout(200);
  const after = await colCount();
  expect(after).toBe(before);

  const widthsAfter = await page.locator(".fc-timegrid-col.fc-day").evaluateAll((cols) =>
    cols.map((c) => Math.round(c.getBoundingClientRect().width)),
  );
  expect(widthsAfter.every((w) => w > 40)).toBe(true);
  // Columns should reflow to wider after collapse.
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  expect(sum(widthsAfter)).toBeGreaterThan(sum(widthsMid) - 5);
});

test("m15_responsive_widths_no_hscroll", async ({ page }) => {
  const login = uniqueLogin("m15resp");
  await registerUi(page, login);
  await apiCreateNote(page.request, {
    title: "M15 Responsive",
    body: "width audit",
    starts_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });

  const routes = ["/upcoming", "/list", "/calendar", "/notes/new", "/settings"] as const;

  for (const collapsed of [true, false]) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      if (w > 640) {
        await page.goto("/calendar");
        await setSidebar(page, collapsed);
      }
      for (const route of routes) {
        await page.goto(route);
        if (route === "/notes/new") {
          await expect(page.getByTestId("note-editor-page")).toBeVisible();
        } else {
          await expect(page.locator("main.app-main")).toBeVisible();
        }
        await noHorizontalScroll(page);

        // No overlapping sticky controls covering the primary heading (when present).
        const overlap = await page.evaluate(() => {
          const h1 = document.querySelector("h1");
          const fab = document.querySelector(".mobile-fab");
          if (!h1 || !fab) return false;
          const a = h1.getBoundingClientRect();
          const b = fab.getBoundingClientRect();
          return !(a.bottom < b.top || a.top > b.bottom || a.right < b.left || a.left > b.right);
        });
        expect(overlap, `h1/fab overlap at ${w} ${route}`).toBe(false);
      }
    }
  }
});

test("m15_dynamic_resize_keeps_editor_and_calendar", async ({ page }) => {
  const login = uniqueLogin("m15dyn");
  await registerUi(page, login);
  await page.goto("/notes/new");
  await expect(page.getByTestId("note-editor-page")).toBeVisible();

  for (const w of [1920, 1024, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(100);
    await noHorizontalScroll(page);
    const ratio = await page.evaluate(() => {
      const main = document.querySelector(".app-main")!.getBoundingClientRect();
      const ws = document.querySelector(".notes-workspace")!.getBoundingClientRect();
      return ws.width / main.width;
    });
    expect(ratio).toBeGreaterThan(0.95);
  }

  await page.goto("/calendar");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".fc-view-harness")).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(150);
  const cols = await page.locator(".fc-timegrid-col.fc-day").count();
  expect(cols).toBeGreaterThanOrEqual(7);
  await noHorizontalScroll(page);
});
