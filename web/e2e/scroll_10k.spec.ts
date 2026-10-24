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

  // Spec §8: ≤ 50 DOM rows; scroll loads more pages without freezes.
  let maxDomRows = 0;
  for (let step = 0; step < 40; step++) {
    const h0 = await list.evaluate((el) => el.scrollHeight);
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    const deadline = Date.now() + 10_000;
    let h1 = h0;
    while (Date.now() < deadline) {
      const rows = await page.locator(".virtual-row").count();
      expect(rows).toBeLessThanOrEqual(50);
      maxDomRows = Math.max(maxDomRows, rows);
      h1 = await list.evaluate((el) => el.scrollHeight);
      if (h1 > h0) break;
    }

    if (h1 <= h0) {
      // Already have a tall virtual list — end of useful growth.
      if (h0 >= 64 * 100) break;
      throw new Error(`list did not grow after scroll (height=${h0})`);
    }
    if (h1 >= 64 * 120) break;
  }

  expect(maxDomRows).toBeGreaterThan(0);
  expect(maxDomRows).toBeLessThanOrEqual(50);
  const scrollHeight = await list.evaluate((el) => el.scrollHeight);
  expect(scrollHeight).toBeGreaterThan(64 * 80);
});
