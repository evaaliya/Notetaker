import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/design/screens");

const WIDTHS = [1440, 1200, 900, 768, 600, 390] as const;

type Box = { x: number; y: number; width: number; height: number };

function overlapArea(a: Box, b: Box): number {
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ox * oy;
}

function within(inner: Box, outer: Box, pad = 1): boolean {
  return (
    inner.x >= outer.x - pad &&
    inner.y >= outer.y - pad &&
    inner.x + inner.width <= outer.x + outer.width + pad &&
    inner.y + inner.height <= outer.y + outer.height + pad
  );
}

async function noPageHScroll(page: Page) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(m.sw, `h-scroll ${m.sw - m.cw}`).toBeLessThanOrEqual(m.cw + 1);
}

async function seedLongNote(page: Page, titlePrefix: string) {
  const title = `${titlePrefix} ${"Заголовок".repeat(24)} очень длинный`;
  const body = `${"Превью строки один с длинным текстом заметки. ".repeat(8)}\n${"Вторая строка превью тоже длинная. ".repeat(8)}\nтретья не должна быть видна целиком`;
  await apiCreateNote(page.request, {
    title,
    body,
    starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [10],
    tag_ids: [],
  });
  return { title, body };
}

test("e2e_list_no_overlap_narrow", async ({ page }) => {
  const login = uniqueLogin("m18ov");
  await registerUi(page, login);
  await page.request.post("/api/tags", {
    data: { name: `M18Tag_${Date.now().toString(36)}`, color: "#3E6FB0" },
  });
  const tags = await (await page.request.get("/api/tags")).json();
  const tagId = tags[0].id as string;
  await apiCreateNote(page.request, {
    title: `M18 overlap ${"X".repeat(80)}`,
    body: `${"Y".repeat(120)}\n${"Z".repeat(120)}`,
    starts_at: new Date(Date.now() + 7200_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [10, 60],
    tag_ids: [tagId],
  });
  await page.evaluate(() => localStorage.setItem("notetaker.sidebarCollapsed", "0"));

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/list");
    const row = page.getByTestId("list-note-row").first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const boxes = await row.evaluate((el) => {
      const q = (sel: string) => el.querySelector(sel);
      const box = (node: Element | null) => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        row: box(el)!,
        title: box(q('[data-testid="list-note-title"]')),
        preview: box(q('[data-testid="list-note-preview"]')),
        meta: box(q(".list-note-meta")),
        tags: box(q(".list-tags")),
        actions: box(q(".note-actions")),
        illu: box(q(".note-illustration")),
      };
    });

    expect(boxes.title && boxes.preview && boxes.meta && boxes.tags).toBeTruthy();
    const parts: [string, Box][] = [
      ["title", boxes.title!],
      ["preview", boxes.preview!],
      ["meta", boxes.meta!],
      ["tags", boxes.tags!],
    ];
    if (boxes.actions && boxes.actions.width > 0) {
      parts.push(["actions", boxes.actions]);
    }
    if (boxes.illu) parts.push(["illu", boxes.illu]);
    for (const [name, b] of parts) {
      expect(within(b, boxes.row), `${w}: ${name} outside row`).toBe(true);
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const area = overlapArea(parts[i][1], parts[j][1]);
        expect(area, `${w}: ${parts[i][0]}/${parts[j][0]} overlap=${area}`).toBeLessThanOrEqual(2);
      }
    }
    await noPageHScroll(page);
  }
});

test("e2e_list_text_truncates", async ({ page }) => {
  const login = uniqueLogin("m18tr");
  await registerUi(page, login);
  await seedLongNote(page, "M18 trunc");
  await page.evaluate(() => localStorage.setItem("notetaker.sidebarCollapsed", "0"));

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/list");
    await expect(page.getByTestId("list-note-row").first()).toBeVisible({ timeout: 15_000 });

    const metrics = await page.evaluate(() => {
      const title = document.querySelector('[data-testid="list-note-title"]') as HTMLElement | null;
      const titleText = document.querySelector(".list-note-title-text") as HTMLElement | null;
      const preview = document.querySelector(
        '[data-testid="list-note-preview"]',
      ) as HTMLElement | null;
      const row = document.querySelector('[data-testid="list-note-row"]') as HTMLElement | null;
      if (!title || !titleText || !preview || !row) return null;
      const tCs = getComputedStyle(titleText);
      const pCs = getComputedStyle(preview);
      const lineH = parseFloat(pCs.lineHeight);
      const lines =
        Number.isFinite(lineH) && lineH > 0
          ? Math.round(preview.clientHeight / lineH)
          : Math.ceil(preview.clientHeight / 16);
      return {
        title: {
          scrollW: title.scrollWidth,
          clientW: title.clientWidth,
          textScrollW: titleText.scrollWidth,
          textClientW: titleText.clientWidth,
          textOverflow: tCs.textOverflow,
          whiteSpace: tCs.whiteSpace,
          beyondRow: title.getBoundingClientRect().right - row.getBoundingClientRect().right,
        },
        preview: {
          scrollW: preview.scrollWidth,
          clientW: preview.clientWidth,
          lineClamp: pCs.webkitLineClamp,
          lines,
        },
      };
    });
    expect(metrics).toBeTruthy();
    // Clipping container must not expand past its box (D-101).
    expect(
      metrics!.title.scrollW,
      `${w}: title scrollW>${metrics!.title.clientW}`,
    ).toBeLessThanOrEqual(metrics!.title.clientW + 1);
    expect(metrics!.title.beyondRow, `${w}: title beyond row`).toBeLessThanOrEqual(1);
    expect(metrics!.title.textOverflow).toBe("ellipsis");
    expect(metrics!.title.whiteSpace).toBe("nowrap");
    // Inner text is truncated (content wider than visible box).
    expect(metrics!.title.textScrollW).toBeGreaterThan(metrics!.title.textClientW);
    expect(
      metrics!.preview.scrollW,
      `${w}: preview scrollW>${metrics!.preview.clientW}`,
    ).toBeLessThanOrEqual(metrics!.preview.clientW + 1);
    expect(metrics!.preview.lineClamp).toBe("2");
    expect(metrics!.preview.lines, `${w}: preview lines`).toBeLessThanOrEqual(2);
    await noPageHScroll(page);
  }
});

test("e2e_sidebar_content_no_overlap", async ({ page }) => {
  const login = uniqueLogin("m18sb");
  await registerUi(page, login);
  await apiCreateNote(page.request, {
    title: "M18 sidebar check",
    body: "body",
    starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [],
    tag_ids: [],
  });

  for (const collapsed of ["0", "1"] as const) {
    await page.evaluate(
      (c) => localStorage.setItem("notetaker.sidebarCollapsed", c),
      collapsed,
    );
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto("/list");
      await expect(page.getByTestId("list-note-row").first()).toBeVisible({ timeout: 15_000 });

      const hit = await page.evaluate(() => {
        const side = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement | null;
        const main = document.querySelector(".app-main") as HTMLElement | null;
        if (!side || !main) return { overlap: 0, sideDisplay: "missing" };
        const cs = getComputedStyle(side);
        if (cs.display === "none" || cs.visibility === "hidden") {
          return { overlap: 0, sideDisplay: "none" };
        }
        const a = side.getBoundingClientRect();
        const b = main.getBoundingClientRect();
        const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return {
          overlap: ox * oy,
          sideDisplay: cs.display,
          sideW: a.width,
          mainX: b.x,
        };
      });
      expect(hit.overlap, `${w} collapsed=${collapsed} overlap`).toBeLessThanOrEqual(1);
      await noPageHScroll(page);
    }
  }
});

test("e2e_list_rows_no_vertical_overlap", async ({ page }) => {
  const login = uniqueLogin("m18vrow");
  await registerUi(page, login);
  await page.request.post("/api/tags", {
    data: { name: `VRow_${Date.now().toString(36)}`, color: "#3E6FB0" },
  });
  const tags = await (await page.request.get("/api/tags")).json();
  const tagId = tags[0].id as string;
  for (let i = 0; i < 6; i++) {
    await apiCreateNote(page.request, {
      title: `VRow ${i} ${"заголовок ".repeat(6)}`,
      body: `превью ${i} `.repeat(20),
      starts_at: new Date(Date.now() + (i + 1) * 3600_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
      reminder_offsets: [10],
      tag_ids: [tagId],
    });
  }
  await page.evaluate(() => localStorage.setItem("notetaker.sidebarCollapsed", "1"));

  for (const w of [900, 768] as const) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/list");
    await expect(page.getByTestId("list-note-row").first()).toBeVisible({ timeout: 15_000 });
    // Let virtualizer measure after tags/actions layout.
    await page.waitForTimeout(200);

    const gaps = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="list-note-row"]')].slice(0, 5);
      const boxes = rows.map((el) => {
        const r = el.getBoundingClientRect();
        return { y: r.y, bottom: r.bottom, h: r.height };
      });
      const out: number[] = [];
      for (let i = 0; i < boxes.length - 1; i++) {
        out.push(boxes[i + 1].y - boxes[i].bottom);
      }
      return { boxes, gaps: out };
    });

    expect(gaps.boxes.length, `${w}: too few rows`).toBeGreaterThanOrEqual(3);
    for (const b of gaps.boxes) {
      expect(b.h, `${w}: row height`).toBeGreaterThan(100);
    }
    for (let i = 0; i < gaps.gaps.length; i++) {
      expect(
        gaps.gaps[i],
        `${w}: rows ${i}/${i + 1} overlap gap=${gaps.gaps[i]}`,
      ).toBeGreaterThanOrEqual(-1);
    }
  }
});

test("m18_list_screenshots_1200_768_390", async ({ page }) => {
  const login = uniqueLogin("m18shot");
  await registerUi(page, login);
  await seedLongNote(page, "M18 shot");
  await page.request.post("/api/tags", {
    data: { name: `ShotTag_${Date.now().toString(36)}`, color: "#2F6B4B" },
  });
  const tags = await (await page.request.get("/api/tags")).json();
  await apiCreateNote(page.request, {
    title: "Короткая заметка со тегом",
    body: "обычное превью",
    starts_at: new Date(Date.now() + 5400_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [60],
    tag_ids: [tags[0].id],
  });
  // Screenshots: product default (collapsed sidebar). Overlap tests above keep expanded.
  await page.evaluate(() => localStorage.setItem("notetaker.sidebarCollapsed", "1"));

  for (const w of [1200, 768, 390] as const) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
    await page.goto("/list");
    await expect(page.getByTestId("list-note-row").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: path.join(OUT, `list-${w}.png`),
      fullPage: true,
    });
  }
});
