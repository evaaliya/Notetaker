import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

test("e2e_list_actions_menu_not_clipped_on_narrow", async ({ page }) => {
  const login = uniqueLogin("ovflow");
  await registerUi(page, login);
  const title = `OverflowMenu ${Date.now()}`;
  await apiCreateNote(page.request, {
    title,
    body: "preview body that should stay readable under the actions menu",
    starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/list");
  await expect(page.getByTestId("list-note-title").filter({ hasText: title })).toBeVisible();

  const actions = page.getByRole("button", { name: "Действия" }).first();
  await expect(actions).toBeVisible();
  await actions.click();

  const menu = page.getByTestId("overflow-menu-list");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "В корзину" })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="overflow-menu-list"]') as HTMLElement | null;
    const virtual = document.querySelector(".virtual-list") as HTMLElement | null;
    const titleEl = document.querySelector('[data-testid="list-note-title"]') as HTMLElement | null;
    if (!list) return null;
    const mr = list.getBoundingClientRect();
    const vr = virtual?.getBoundingClientRect();
    const tr = titleEl?.getBoundingClientRect();
    // Menu must be a direct child of body (portaled), not clipped by virtual-list.
    const portaled = list.parentElement === document.body;
    const inViewport =
      mr.top >= 0 &&
      mr.left >= 0 &&
      mr.bottom <= window.innerHeight + 1 &&
      mr.right <= window.innerWidth + 1;
    // Not overlapping the note title block meaningfully (prefer actions column).
    const overlapsTitle =
      tr != null &&
      !(mr.right <= tr.left || mr.left >= tr.right || mr.bottom <= tr.top || mr.top >= tr.bottom);
    // If virtual-list exists, menu should not be its descendant.
    const insideVirtual = virtual ? virtual.contains(list) : false;
    return {
      portaled,
      inViewport,
      overlapsTitle,
      insideVirtual,
      clippedByVirtual:
        vr != null && !portaled
          ? mr.bottom > vr.bottom + 1 || mr.top < vr.top - 1
          : false,
    };
  });

  expect(geometry).toBeTruthy();
  expect(geometry!.portaled).toBe(true);
  expect(geometry!.insideVirtual).toBe(false);
  expect(geometry!.inViewport).toBe(true);
  expect(geometry!.clippedByVirtual).toBe(false);
  // Title may share Y-band on narrow rows; menu is right-aligned to trigger — must not cover title text area heavily.
  if (geometry!.overlapsTitle) {
    const titleBox = await page.getByTestId("list-note-title").first().boundingBox();
    const menuBox = await menu.boundingBox();
    expect(titleBox && menuBox).toBeTruthy();
    // Menu should start at/after the right half of the title row.
    expect(menuBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width * 0.35);
  }
});
