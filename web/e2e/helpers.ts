import { expect, type APIRequestContext, type Page } from "@playwright/test";

export function uniqueLogin(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function apiRegister(
  request: APIRequestContext,
  login: string,
  password = "secret",
): Promise<void> {
  const res = await request.post("/api/auth/register", {
    data: { login, password },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function loginUi(page: Page, login: string, password = "secret"): Promise<void> {
  await page.goto("/");
  // Auth screen or already logged-in shell.
  await expect(
    page.getByRole("navigation").or(page.locator('input[autocomplete="username"]')),
  ).toBeVisible({ timeout: 15_000 });
  if (await page.getByRole("navigation").isVisible()) {
    return;
  }
  // Ensure login mode (not register).
  const createBtn = page.getByRole("button", { name: "Создать аккаунт" });
  if (!(await createBtn.isVisible())) {
    await page.getByRole("button", { name: "Уже есть аккаунт" }).click();
  }
  await page.locator('input[autocomplete="username"]').fill(login);
  await page.locator('input[type="password"]').fill(password);
  await page.locator("form").getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}

export async function registerUi(page: Page, login: string, password = "secret"): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.locator('input[autocomplete="username"]').fill(login);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}

export async function apiCreateNote(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ id: string; title: string; version: number; starts_at: string }> {
  const res = await request.post("/api/notes", { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

export async function waitForWsReady(page: Page): Promise<void> {
  await expect
    .poll(async () => page.evaluate(() => !!(window as unknown as { __wsReady?: boolean }).__wsReady), {
      timeout: 10_000,
    })
    .toBe(true);
}
