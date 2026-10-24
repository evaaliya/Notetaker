import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  apiCreateNote,
  apiRegister,
  loginUi,
  registerUi,
  uniqueLogin,
  waitForWsReady,
} from "./helpers";

async function twoLoggedInTabs(
  browser: Browser,
  login: string,
): Promise<{ ctxA: BrowserContext; ctxB: BrowserContext; a: Page; b: Page }> {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await loginUi(a, login);
  const cookies = await ctxA.cookies();
  await ctxB.addCookies(cookies);
  await b.goto("/calendar");
  await expect(b.getByRole("navigation")).toBeVisible();
  await waitForWsReady(a);
  await waitForWsReady(b);
  return { ctxA, ctxB, a, b };
}

test("e2e_toast_in_two_tabs", async ({ browser, request }) => {
  const login = uniqueLogin("toast2");
  await apiRegister(request, login);
  const note = await apiCreateNote(request, {
    title: "Toast twin",
    body: "hi",
    starts_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    reminder_offsets: [10],
    tag_ids: [],
  });

  const { ctxA, ctxB, a, b } = await twoLoggedInTabs(browser, login);
  try {
    const due = await a.request.post("/api/e2e/make_reminder_due", {
      data: { note_id: note.id },
    });
    expect(due.ok(), await due.text()).toBeTruthy();
    const tick = await a.request.post("/api/e2e/tick_reminders");
    expect(tick.ok(), await tick.text()).toBeTruthy();

    await expect(a.getByTestId("toast").filter({ hasText: "Toast twin" })).toBeVisible();
    await expect(b.getByTestId("toast").filter({ hasText: "Toast twin" })).toBeVisible();
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("e2e_toast_not_repeated_after_reload", async ({ page, request }) => {
  const login = uniqueLogin("toast1");
  await apiRegister(request, login);
  const note = await apiCreateNote(request, {
    title: "Once toast",
    body: "",
    starts_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    reminder_offsets: [5],
    tag_ids: [],
  });

  await loginUi(page, login);
  await waitForWsReady(page);

  const due = await page.request.post("/api/e2e/make_reminder_due", {
    data: { note_id: note.id },
  });
  expect(due.ok(), await due.text()).toBeTruthy();
  const tick = await page.request.post("/api/e2e/tick_reminders");
  expect(tick.ok(), await tick.text()).toBeTruthy();

  const toast = page.getByTestId("toast").filter({ hasText: "Once toast" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Закрыть" }).click();
  await expect(page.getByTestId("toast")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByTestId("toast")).toHaveCount(0);
});

test("e2e_edit_in_tab_a_visible_in_tab_b", async ({ browser }) => {
  const login = uniqueLogin("sync");
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await registerUi(a, login);
  const cookies = await ctxA.cookies();
  const ctxB = await browser.newContext();
  await ctxB.addCookies(cookies);
  const b = await ctxB.newPage();
  await b.goto("/list");
  await expect(b.getByRole("navigation")).toBeVisible();
  await waitForWsReady(a);
  await waitForWsReady(b);

  try {
    const title = `Sync ${Date.now()}`;
    const starts = new Date();
    starts.setUTCMinutes(0, 0, 0);
    starts.setUTCHours(starts.getUTCHours() + 3);
    const note = await apiCreateNote(a.request, {
      title,
      body: "v1",
      starts_at: starts.toISOString(),
      reminder_offsets: [],
      tag_ids: [],
    });

    await a.goto("/list");
    await b.goto("/list");
    await expect(a.getByText(title)).toBeVisible();
    await expect(b.getByText(title)).toBeVisible();

    const patched = await a.request.patch(`/api/notes/${note.id}`, {
      data: { version: note.version, title: `${title} edited` },
    });
    expect(patched.ok(), await patched.text()).toBeTruthy();

    await expect(b.getByText(`${title} edited`)).toBeVisible();
    await expect(a.getByText(`${title} edited`)).toBeVisible();

    await a.goto("/upcoming");
    await b.goto("/upcoming");
    await expect(b.getByText(`${title} edited`)).toBeVisible();

    await a.goto("/calendar");
    await b.goto("/calendar");
    await expect(b.locator(".fc-event").filter({ hasText: `${title} edited` })).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("e2e_conflict_dialog", async ({ browser }) => {
  const login = uniqueLogin("conflict");
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await registerUi(a, login);
  const cookies = await ctxA.cookies();
  const ctxB = await browser.newContext();
  await ctxB.addCookies(cookies);
  const b = await ctxB.newPage();

  try {
    const title = `Conflict ${Date.now()}`;
    const starts = new Date(Date.now() + 3600_000).toISOString();
    const note = await apiCreateNote(a.request, {
      title,
      body: "base",
      starts_at: starts,
      reminder_offsets: [],
      tag_ids: [],
    });

    await a.goto("/upcoming");
    await b.goto("/upcoming");
    await waitForWsReady(a);
    await waitForWsReady(b);

    await a.getByText(title).click();
    await b.getByText(title).click();

    await a.locator(".side-panel input").first().fill(`${title} A`);
    await b.locator(".side-panel textarea").fill("draft B keep me");

    await a.locator(".side-panel").getByRole("button", { name: "Сохранить" }).click();
    await expect(a.locator(".side-panel input").first()).toHaveValue(`${title} A`);

    await b.locator(".side-panel").getByRole("button", { name: "Сохранить" }).click();
    await expect(b.getByTestId("conflict-dialog")).toBeVisible();
    await expect(b.getByTestId("conflict-dialog").getByText("draft B keep me")).toBeVisible();

    await b.getByTestId("conflict-mine").click();
    await expect(b.getByTestId("conflict-dialog")).toHaveCount(0);

    const got = await b.request.get(`/api/notes/${note.id}`);
    const body = await got.json();
    expect(body.body).toBe("draft B keep me");
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("e2e_upcoming_moves_to_past_live", async ({ page, request }) => {
  const login = uniqueLogin("usenow");
  await apiRegister(request, login);
  await loginUi(page, login);

  const title = `Live past ${Date.now()}`;
  const starts = new Date(Date.now() + 2500);
  await apiCreateNote(request, {
    title,
    body: "",
    starts_at: starts.toISOString(),
    reminder_offsets: [],
    tag_ids: [],
  });

  await page.goto("/upcoming");
  await expect(page.getByTestId("bucket-today").getByText(title)).toBeVisible();

  await expect
    .poll(
      async () => page.getByTestId("bucket-past").getByText(title).count(),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  await expect(page.getByTestId("bucket-today").getByText(title)).toHaveCount(0);
});
