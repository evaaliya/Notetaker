import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

test("e2e_list_period_filter_and_reset", async ({ page }) => {
  const login = uniqueLogin("listper");
  await registerUi(page, login);
  await page.request.patch("/api/me", { data: { timezone: "UTC" } });

  const tagRes = await page.request.post("/api/tags", {
    data: { name: "PeriodTag", color: "#336699" },
  });
  expect(tagRes.ok(), await tagRes.text()).toBeTruthy();
  const tagId = (await tagRes.json()).id as string;

  await apiCreateNote(page.request, {
    title: "InPeriod",
    body: "apple",
    starts_at: "2026-10-21T12:00:00Z",
    reminder_offsets: [],
    tag_ids: [tagId],
    status: "active",
  });
  await apiCreateNote(page.request, {
    title: "OutPeriod",
    body: "apple",
    starts_at: "2026-10-10T12:00:00Z",
    reminder_offsets: [],
    tag_ids: [tagId],
    status: "active",
  });
  await apiCreateNote(page.request, {
    title: "InactiveInPeriod",
    body: "other",
    starts_at: "2026-10-21T15:00:00Z",
    reminder_offsets: [],
    tag_ids: [],
    status: "inactive",
  });

  await page.goto("/list");
  await expect(page.getByTestId("list-toolbar")).toBeVisible();

  await page.getByTestId("list-from").fill("2026-10-21");
  await page.getByTestId("list-to").fill("2026-10-22");
  await page.getByTestId("list-search").fill("apple");
  await page.getByTestId("list-tag-filter").selectOption({ label: "PeriodTag" });
  await page.getByTestId("list-status-filter").selectOption("active");
  await page.getByTestId("list-sort-filter").selectOption("starts_at:desc");
  await page.getByTestId("list-apply").click();

  await expect(
    page.getByTestId("list-note-title").filter({ hasText: /^InPeriod$/ }),
  ).toBeVisible();
  await expect(
    page.getByTestId("list-note-title").filter({ hasText: /^OutPeriod$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("list-note-title").filter({ hasText: /^InactiveInPeriod$/ }),
  ).toHaveCount(0);

  // Persist in session until reset (reload clears React state — intentional).
  await expect(page.getByTestId("list-from")).toHaveValue("2026-10-21");

  await page.getByTestId("list-reset").click();
  await expect(page.getByTestId("list-from")).toHaveValue("");
  await expect(page.getByTestId("list-to")).toHaveValue("");
  await expect(page.getByTestId("list-search")).toHaveValue("");
  await expect(page.getByTestId("list-tag-filter")).toHaveValue("");
  await expect(page.getByTestId("list-status-filter")).toHaveValue("");
  // Sort kept.
  await expect(page.getByTestId("list-sort-filter")).toHaveValue("starts_at:desc");

  await expect(
    page.getByTestId("list-note-title").filter({ hasText: /^OutPeriod$/ }),
  ).toBeVisible();
  await expect(
    page.getByTestId("list-note-title").filter({ hasText: /^InPeriod$/ }),
  ).toBeVisible();
});

test("e2e_list_period_from_after_to_error", async ({ page }) => {
  const login = uniqueLogin("listbad");
  await registerUi(page, login);
  await page.goto("/list");
  await page.getByTestId("list-from").fill("2026-10-25");
  await page.getByTestId("list-to").fill("2026-10-20");
  await page.getByTestId("list-apply").click();
  await expect(page.getByTestId("list-period-error")).toBeVisible();
});
