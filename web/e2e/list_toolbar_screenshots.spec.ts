import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const WIDTHS = [1440, 1280, 1024, 768, 390] as const;
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../reports/ui-fix-2026-11-04",
);

test.describe.configure({ mode: "serial" });

test("e2e_list_toolbar_screenshots_and_no_overlap", async ({ page }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const login = uniqueLogin("tbshot");
  await registerUi(page, login);
  await apiCreateNote(page.request, {
    title: "Toolbar shot",
    body: "",
    starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [],
    tag_ids: [],
  });
  await page.goto("/list");
  const toolbar = page.getByTestId("list-toolbar");
  await expect(toolbar).toBeVisible();

  const phase = process.env.UI_FIX_PHASE; // "before" | "after" → write screenshots

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    if (phase === "before" || phase === "after") {
      await toolbar.screenshot({
        path: path.join(OUT_DIR, `list-toolbar-${phase}-${w}.png`),
      });
    }

    const overlap = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="list-toolbar"]');
      if (!root) return { ok: false, reason: "no toolbar" };
      const nodes = Array.from(
        root.querySelectorAll("select, input[type=date], button, .list-period-field"),
      ) as HTMLElement[];
      const boxes = nodes
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, r };
        })
        .filter((x) => x.r.width > 0 && x.r.height > 0);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r;
          const b = boxes[j].r;
          const intersects = !(
            a.right <= b.left + 1 ||
            a.left >= b.right - 1 ||
            a.bottom <= b.top + 1 ||
            a.top >= b.bottom - 1
          );
          if (intersects) {
            if (
              boxes[i].el.contains(boxes[j].el) ||
              boxes[j].el.contains(boxes[i].el)
            ) {
              continue;
            }
            return {
              ok: false,
              reason: `${boxes[i].el.tagName}/${boxes[i].el.getAttribute("aria-label") || boxes[i].el.getAttribute("data-testid")} overlaps ${boxes[j].el.tagName}/${boxes[j].el.getAttribute("aria-label") || boxes[j].el.getAttribute("data-testid")}`,
            };
          }
        }
      }
      return { ok: true };
    });
    // Overlap assert only after the CSS fix (before-phase documents the bug).
    if (phase !== "before") {
      expect(overlap, `width ${w}: ${JSON.stringify(overlap)}`).toEqual({ ok: true });
    }
  }
});
