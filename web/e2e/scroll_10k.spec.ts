import { expect, test } from "@playwright/test";
import { apiRegister, loginUi, uniqueLogin } from "./helpers";

test("e2e_scroll_10k", async ({ page, request }) => {
  test.setTimeout(180_000);
  const login = uniqueLogin("scroll10k");
  await apiRegister(request, login);
  await loginUi(page, login);

  const seed = await page.request.post("/api/e2e/seed_notes", {
    data: { count: 10_000 },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();
  expect((await seed.json()).inserted).toBe(10_000);

  await page.goto("/list");
  const list = page.locator(".virtual-list");
  await expect(list).toBeVisible();
  await expect(page.locator(".virtual-row").first()).toBeVisible({ timeout: 30_000 });

  // Spec §8: virtualization ≤ 50 DOM rows; scroll without freezes.
  let maxDomRows = 0;
  for (let step = 0; step < 25; step++) {
    const before = await list.evaluate((el) => el.scrollTop);
    await list.evaluate((el) => {
      el.scrollTop = Math.min(el.scrollTop + 2400, el.scrollHeight);
    });
    await expect
      .poll(async () => list.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(before);

    const rows = await page.locator(".virtual-row").count();
    maxDomRows = Math.max(maxDomRows, rows);
    expect(rows).toBeLessThanOrEqual(50);
  }

  expect(maxDomRows).toBeGreaterThan(0);
  expect(maxDomRows).toBeLessThanOrEqual(50);

  const scrollHeight = await list.evaluate((el) => el.scrollHeight);
  // Many pages loaded into the virtualizer total size (estimateSize ≈ 64px).
  expect(scrollHeight).toBeGreaterThan(64 * 80);
});
