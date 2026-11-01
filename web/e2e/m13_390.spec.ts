import { test, expect } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

test("m13_390_no_hscroll_and_more_menu", async ({ page }) => {
  const login = uniqueLogin("m13m");
  await registerUi(page, login);
  await apiCreateNote(page.request, {
    title: "M13 narrow note",
    body: "body",
    starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [10],
    tag_ids: [],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/list", "/upcoming", "/calendar", "/settings"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    expect(overflow.scrollWidth - overflow.clientWidth, path).toBeLessThanOrEqual(1);
  }
  await page.goto("/list");
  await expect(page.getByTestId("mobile-nav-more")).toBeVisible();
  await page.getByTestId("mobile-nav-more").click();
  await expect(page.getByTestId("mobile-nav-more-menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Теги" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Звонок" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Видео" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Настройки" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Звонок" }).click();
  await expect(page).toHaveURL(/\/capture\/call/);
  await page.goto("/list");
  await expect(page.getByRole("button", { name: "Действия" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Действия" }).first().click();
  await expect(page.getByRole("menuitem", { name: "В корзину" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /активн/i })).toBeVisible();
});
