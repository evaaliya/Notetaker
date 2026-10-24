import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { loginUi, registerUi, uniqueLogin, waitForWsReady } from "./helpers";

const MAILHOG = process.env.MAILHOG_URL || "http://127.0.0.1:8025";

function utcDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

async function clearMailhog(): Promise<void> {
  await fetch(`${MAILHOG}/api/v1/messages`, { method: "DELETE" });
}

async function mailhogCountForSubject(subject: string): Promise<number> {
  const res = await fetch(`${MAILHOG}/api/v2/messages`);
  expect(res.ok).toBeTruthy();
  const body = (await res.json()) as {
    items?: { Content?: { Headers?: { Subject?: string[] } } }[];
  };
  const items = body.items ?? [];
  return items.filter((m) => (m.Content?.Headers?.Subject ?? []).includes(subject)).length;
}

async function twoTabs(
  browser: Browser,
  login: string,
): Promise<{ ctxA: BrowserContext; ctxB: BrowserContext; a: Page; b: Page }> {
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await loginUi(a, login);
  const cookies = await ctxA.cookies();
  const ctxB = await browser.newContext();
  await ctxB.addCookies(cookies);
  const b = await ctxB.newPage();
  await b.goto("/list");
  await expect(b.getByRole("navigation")).toBeVisible();
  await waitForWsReady(a);
  await waitForWsReady(b);
  return { ctxA, ctxB, a, b };
}

test("e2e_reminder_from_ui_toast_and_mail", async ({ browser }) => {
  const login = uniqueLogin("ui_rem");
  const title = `UI reminder ${Date.now()}`;
  const email = `${login}@example.com`;

  const ctxSetup = await browser.newContext();
  const setup = await ctxSetup.newPage();
  await registerUi(setup, login);

  // Settings: email field present and persists.
  await setup.goto("/settings");
  await expect(setup.getByTestId("settings-email")).toBeVisible();
  await setup.getByTestId("settings-email").fill(email);
  await setup.getByRole("button", { name: "Сохранить" }).click();
  await expect(setup.getByText("Сохранено")).toBeVisible();
  await setup.reload();
  await expect(setup.getByTestId("settings-email")).toHaveValue(email);
  await ctxSetup.close();

  await clearMailhog();

  const { ctxA, ctxB, a, b } = await twoTabs(browser, login);
  try {
    await a.goto("/list");
    await a.getByTestId("new-note").click();
    await expect(a.getByTestId("note-form")).toBeVisible();
    await expect(a.getByTestId("reminder-offsets")).toBeVisible();

    const starts = new Date(Date.now() + 11 * 60 * 1000);
    await a.getByTestId("note-title").fill(title);
    await a.getByTestId("note-starts").fill(utcDatetimeLocal(starts));
    await a.getByTestId("reminder-offset-10").check();
    await a.getByTestId("note-form").getByRole("button", { name: "Сохранить" }).click();
    await expect(a.getByText(title)).toBeVisible();

    // Confirm offsets persisted (side panel / edit form).
    await a.getByText(title).click();
    await expect(a.getByTestId("reminder-offset-10")).toBeChecked();
    await a.getByRole("button", { name: "Отмена" }).click();

    const list = await a.request.get("/api/notes");
    expect(list.ok()).toBeTruthy();
    const notes = (await list.json()) as { items: { id: string; title: string }[] };
    const note = notes.items.find((n) => n.title === title);
    expect(note).toBeTruthy();

    const due = await a.request.post("/api/e2e/make_reminder_due", {
      data: { note_id: note!.id },
    });
    expect(due.ok(), await due.text()).toBeTruthy();
    const tick = await a.request.post("/api/e2e/tick_reminders");
    expect(tick.ok(), await tick.text()).toBeTruthy();

    await expect(a.getByTestId("toast").filter({ hasText: title })).toBeVisible();
    await expect(b.getByTestId("toast").filter({ hasText: title })).toBeVisible();

    await expect
      .poll(async () => mailhogCountForSubject(title), { timeout: 15_000 })
      .toBe(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
