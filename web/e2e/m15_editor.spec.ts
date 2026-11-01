import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("m15_editor_full_width_and_meta_toggle", async ({ page }) => {
  const login = uniqueLogin("m15ed");
  await registerUi(page, login);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/notes/new");
  await expect(page.getByTestId("note-title")).toBeVisible();
  await expect(page.getByTestId("note-body")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const body = document.querySelector(".note-editor-body");
    const pane = document.querySelector(".note-editor-pane");
    const title = document.querySelector('[data-testid="note-title"]');
    const ta = document.querySelector('[data-testid="note-body"]');
    const bar = document.querySelector('[data-testid="note-meta-bar"]');
    if (!body || !pane || !title || !ta || !bar) {
      return { ok: false as const, reason: "missing nodes" };
    }
    const br = body.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    const barStyle = getComputedStyle(bar);
    return {
      ok: true as const,
      bodyW: Math.round(br.width),
      paneW: Math.round(pr.width),
      titleW: Math.round(title.getBoundingClientRect().width),
      taW: Math.round(ta.getBoundingClientRect().width),
      bodyMax: getComputedStyle(body).maxWidth,
      titleWeight: getComputedStyle(title).fontWeight,
      titleSize: parseFloat(getComputedStyle(title).fontSize),
      bodySize: parseFloat(getComputedStyle(ta).fontSize),
      titleBorder: getComputedStyle(title).borderTopWidth,
      barDirection: barStyle.flexDirection,
      barMaxChildW: Math.max(
        ...Array.from(bar.children).map((c) => c.getBoundingClientRect().width),
        0,
      ),
      barW: bar.getBoundingClientRect().width,
    };
  });
  expect(metrics.ok).toBe(true);
  if (!metrics.ok) return;
  expect(metrics.bodyMax).toBe("none");
  expect(metrics.bodyW / metrics.paneW).toBeGreaterThan(0.92);
  expect(metrics.titleW).toBeGreaterThan(metrics.paneW * 0.7);
  expect(metrics.taW).toBeGreaterThan(metrics.paneW * 0.7);
  expect(Number(metrics.titleWeight)).toBeGreaterThanOrEqual(700);
  expect(metrics.titleSize).toBeGreaterThan(metrics.bodySize);
  expect(metrics.titleBorder).toBe("0px");
  expect(metrics.barDirection).toBe("row");
  // Tools stay compact — not stretched to full bar width.
  expect(metrics.barMaxChildW / metrics.barW).toBeLessThan(0.55);

  await expect(page.getByTestId("meta-reminders")).toHaveAttribute("data-open", "0");
  await expect(page.getByTestId("reminder-offsets-row")).toBeHidden();

  await page.getByTestId("meta-reminders-trigger").click();
  await expect(page.getByTestId("meta-reminders")).toHaveAttribute("data-open", "1");
  await expect(page.getByTestId("reminder-offsets-row")).toBeVisible();
  await page.getByTestId("reminder-offset-60").check();
  await page.getByTestId("meta-reminders-trigger").click();
  await expect(page.getByTestId("meta-reminders")).toHaveAttribute("data-open", "0");
  await expect(page.getByTestId("reminder-offset-60")).toBeChecked();
  await expect(page.getByTestId("meta-reminders-trigger")).toContainText("за час");
});

test("m15_editor_recurrence_and_tags_persist_collapsed", async ({ page }) => {
  const login = uniqueLogin("m15meta");
  await registerUi(page, login);
  const tag = await page.request.post("/api/tags", {
    data: { name: `EdTag_${Date.now()}`, color: "#3E6FB0" },
  });
  expect(tag.ok()).toBeTruthy();
  const tagJson = (await tag.json()) as { id: string; name: string };

  await page.goto("/notes/new");
  await expect(page.getByTestId("note-form")).toBeVisible();
  await page.getByTestId("meta-recurrence-trigger").click();
  await page.getByTestId("recurrence-enabled").check();
  await expect(page.getByTestId("recurrence-freq")).toBeVisible();
  await page.getByTestId("meta-recurrence-trigger").click();
  await expect(page.getByTestId("recurrence-enabled")).toBeChecked();

  // One click on Теги opens the pill list (no nested «Выбрать теги»).
  await page.getByTestId("meta-tags-trigger").click();
  await expect(page.getByTestId("tag-multi-select")).toBeVisible();
  await expect(page.getByTestId("tag-multi-trigger")).toHaveCount(0);
  await expect(page.getByTestId("tag-multi-search")).toHaveCount(0);
  await page.getByTestId(`tag-multi-option-${tagJson.id}`).click();
  await expect(page.getByTestId("tag-multi-chips")).toContainText(tagJson.name);
  await expect(page.getByTestId("note-selected-tags")).toContainText(tagJson.name);
  await page.getByTestId("meta-tags-trigger").click();
  await expect(page.getByTestId("meta-tags")).toHaveAttribute("data-open", "0");
  await expect(page.getByTestId("meta-tags-trigger")).toContainText(tagJson.name);
  await expect(page.getByTestId("note-selected-tags")).toContainText(tagJson.name);
});

test("m15_editor_single_attach_and_body_dnd", async ({ page }) => {
  const login = uniqueLogin("m15dnd");
  await registerUi(page, login);
  const note = await apiCreateNote(page.request, {
    title: "M15 DnD",
    body: "text",
    starts_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  await page.goto(`/notes/${note.id}`);
  await expect(page.getByTestId("note-body-dropzone")).toBeVisible();

  await expect(page.getByText("Перетащите файл сюда")).toHaveCount(0);
  await expect(page.getByTestId("meta-attachments")).toHaveCount(0);
  // Exactly one paperclip control in the editor (toolbar), none next to Закрыть.
  await expect(page.getByTestId("note-attach-btn")).toHaveCount(1);
  await expect(page.getByTestId("attachment-add")).toHaveCount(0);
  const attachInActions = await page
    .locator(".note-editor-actions")
    .getByTestId("note-attach-btn")
    .count();
  expect(attachInActions).toBe(0);

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("note-attach-btn").click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "drop.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  await expect(page.getByTestId("attachment-thumb")).toBeVisible({ timeout: 15_000 });
});

test("m15_editor_responsive_390", async ({ page }) => {
  const login = uniqueLogin("m15ed390");
  await registerUi(page, login);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notes/new");
  await expect(page.getByTestId("note-form")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const barDir = await page
    .getByTestId("note-meta-bar")
    .evaluate((el) => getComputedStyle(el).flexDirection);
  expect(barDir).toBe("row");

  await page.getByTestId("meta-when-trigger").click();
  await expect(page.getByTestId("note-starts")).toBeVisible();
  const box = await page.getByTestId("note-attach-btn").boundingBox();
  expect(box).toBeTruthy();
  expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(36);
});
