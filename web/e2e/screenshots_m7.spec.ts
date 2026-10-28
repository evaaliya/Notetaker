import { expect, test } from "@playwright/test";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/design/screens");

test("m7_screenshots_1280_and_390", async ({ page }) => {
  const login = uniqueLogin("m7shot");
  await registerUi(page, login);
  await page.request.patch("/api/me", {
    data: { timezone: "UTC", email: "m7shot@example.com" },
  });
  const tagRes = await page.request.post("/api/tags", {
    data: { name: "Работа", color: "#3E6FB0" },
  });
  const tag = await tagRes.json();
  await apiCreateNote(page.request, {
    title: "Созвон с командой",
    body: "call",
    starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [10],
    tag_ids: [tag.id],
  });

  const routes: { name: string; path: string }[] = [
    { name: "upcoming", path: "/upcoming" },
    { name: "calendar", path: "/calendar" },
    { name: "list", path: "/list" },
    { name: "tags", path: "/tags" },
    { name: "trash", path: "/trash" },
    { name: "settings", path: "/settings" },
  ];

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const r of routes) {
    await page.goto(r.path);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT, `${r.name}-1280.png`),
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const r of routes) {
    await page.goto(r.path);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(OUT, `${r.name}-390.png`),
      fullPage: true,
    });
  }

  await page.goto("/list");
  await page.getByTestId("mobile-new-note").click();
  await expect(page.getByTestId("quick-add-sheet")).toBeVisible();
  await page.screenshot({
    path: path.join(OUT, "mobile-sheet-390.png"),
    fullPage: true,
  });
});
