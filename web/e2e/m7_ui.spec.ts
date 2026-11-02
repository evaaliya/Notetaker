import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

/** Civil today in UTC at HH:MM → ISO-Z (matches user.timezone=UTC in these tests). */
function todayAtUtc(hour: number, minute = 0): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
}

async function ensureTag(
  page: import("@playwright/test").Page,
  name: string,
  color = "#3E6FB0",
): Promise<string> {
  const list = await page.request.get("/api/tags");
  const tags = (await list.json()) as { id: string; name: string }[];
  const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const res = await page.request.post("/api/tags", { data: { name, color } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const tag = await res.json();
  return tag.id as string;
}

async function gotoWeekWithTitle(page: import("@playwright/test").Page, title: string) {
  await page.goto("/calendar");
  await page.getByTestId("cal-view-week").click();
  // Cluster shows ≤4 cards; the sought title may live in "+N ещё" (D-102).
  await expect
    .poll(async () => page.getByTestId("tl-card").count(), { timeout: 10_000 })
    .toBeGreaterThan(0);
  const inCard = page.getByTestId("tl-card").filter({ hasText: title });
  if ((await inCard.count()) > 0) return;
  const overflow = page.getByTestId("tl-overflow-btn");
  await expect(overflow).toBeVisible({ timeout: 5_000 });
  await overflow.click();
  await expect(page.getByTestId("tl-overflow-item").filter({ hasText: title })).toBeVisible();
  await page.keyboard.press("Escape");
}

test("e2e_tags_visible_everywhere", async ({ page }) => {
  const login = uniqueLogin("m7tags");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const tagId = await ensureTag(page, "Работа", "#3E6FB0");
  const title = `TagEverywhere ${Date.now()}`;
  const note = await apiCreateNote(page.request, {
    title,
    body: "созвон",
    starts_at: todayAtUtc(12, 0),
    reminder_offsets: [10],
    tag_ids: [tagId],
  });

  // Month still shows TagPill on the main pill (week/day timeline does not — M17).
  await page.goto("/calendar");
  await page.getByTestId("cal-view-month").click();
  const calEvent = page.locator(".fc-event").filter({ hasText: title });
  await expect(calEvent).toBeVisible();
  await expect(calEvent.getByTestId("tag-pill")).toContainText("Работа");

  await page.goto("/list");
  const listRow = page.locator(".list-row, .note-row").filter({ hasText: title });
  await expect(listRow.getByTestId("tag-pill")).toContainText("Работа");

  await page.goto("/upcoming");
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByTestId("tag-pill").filter({ hasText: "Работа" }).first()).toBeVisible();

  const del = await page.request.delete(`/api/notes/${note.id}`);
  expect(del.ok()).toBeTruthy();
  await page.goto("/trash");
  const trashRow = page.locator(".trash-row, .note-row").filter({ hasText: title });
  await expect(trashRow).toBeVisible();
  await expect(trashRow.getByTestId("tag-pill")).toContainText("Работа");
});

test("e2e_week_many_notes_in_slot", async ({ page }) => {
  const login = uniqueLogin("m7slot");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const starts = todayAtUtc(10, 0);
  const titles: string[] = [];
  for (let i = 0; i < 5; i++) {
    const title = `Slot${i}_${Date.now()}`;
    titles.push(title);
    await apiCreateNote(page.request, {
      title,
      body: "",
      starts_at: starts,
      reminder_offsets: [],
      tag_ids: [],
    });
  }
  await gotoWeekWithTitle(page, titles[0]);
  // M17: up to 4 visible cards + overflow for the rest.
  await expect(page.getByTestId("tl-card")).toHaveCount(4);
  await expect(page.getByTestId("tl-overflow-btn")).toContainText("+1 ещё");
  await page.getByTestId("tl-overflow-btn").click();
  for (const t of titles) {
    await expect(page.getByTestId("tl-overflow-item").filter({ hasText: t })).toBeVisible();
  }
});

test("e2e_drag_to_trash", async ({ page }) => {
  const login = uniqueLogin("m7drag");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });
  const title = `DragTrash ${Date.now()}`;
  const note = await apiCreateNote(page.request, {
    title,
    body: "",
    starts_at: todayAtUtc(14, 0),
    reminder_offsets: [],
    tag_ids: [],
  });

  // DnD trash is month-only (M17 / D-098).
  await page.goto("/calendar");
  await page.getByTestId("cal-view-month").click();
  const event = page.locator(".fc-event").filter({ hasText: title });
  await expect(event).toBeVisible();
  const zone = page.getByTestId("cal-trash-zone");
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="cal-trash-zone"]') as HTMLElement | null;
    if (el) {
      el.classList.add("visible", "active");
      el.style.opacity = "1";
      el.style.pointerEvents = "auto";
    }
  });

  await event.dragTo(zone, { force: true });
  await expect(page.getByTestId("trash-undo")).toBeVisible({ timeout: 8000 });
  await page.getByTestId("trash-undo").click();
  await expect(page.getByTestId("trash-undo")).toHaveCount(0);
  await expect(
    page.locator(".fc-event:not(.fc-event-dragging)").filter({ hasText: title }).first(),
  ).toBeVisible({ timeout: 8000 });
  await expect
    .poll(async () => {
      const trash = await page.request.get("/api/notes/trash");
      const trashItems = (await trash.json()) as { id: string }[];
      return trashItems.some((n) => n.id === note.id);
    })
    .toBeFalsy();
});

test("e2e_mobile_quick_add", async ({ page }) => {
  const login = uniqueLogin("m7mob");
  await registerUi(page, login);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/list");
  await expect(page.getByTestId("mobile-new-note")).toBeVisible();
  await page.getByTestId("mobile-new-note").click();
  await expect(page.getByTestId("quick-add-sheet")).toBeVisible();
  const title = `MobileAdd ${Date.now()}`;
  await page.getByTestId("note-title").fill(title);
  await page.getByTestId("quick-add-submit").click();
  await expect(page.getByTestId("quick-add-sheet")).toBeHidden({ timeout: 8000 });
  await expect(page.getByText(title)).toBeVisible({ timeout: 8000 });
});
