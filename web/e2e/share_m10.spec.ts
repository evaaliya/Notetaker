import { expect, test } from "@playwright/test";
import {
  apiCreateNote,
  apiRegister,
  loginUi,
  uniqueLogin,
  waitForWsReady,
} from "./helpers";

test("e2e_two_users_shared_note", async ({ browser }) => {
  const ownerLogin = uniqueLogin("own");
  const memberLogin = uniqueLogin("mem");
  const title = `Shared ${Date.now().toString(36)}`;

  const ownerCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  const memberPage = await memberCtx.newPage();

  try {
    await apiRegister(ownerCtx.request, ownerLogin);
    await apiRegister(memberCtx.request, memberLogin);

    await loginUi(ownerPage, ownerLogin);
    await loginUi(memberPage, memberLogin);

    // Member stays on list so WS invalidation shows the shared note without reload.
    await memberPage.goto("/list");
    await waitForWsReady(memberPage);
    await waitForWsReady(ownerPage);

    const note = await apiCreateNote(ownerCtx.request, {
      title,
      body: "shared body",
      starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      reminder_offsets: [],
      tag_ids: [],
    });

    // Share via UI (catches nested-form regressions — D-060).
    await ownerPage.goto(`/notes/${note.id}`);
    await expect(ownerPage.getByTestId("share-panel")).toBeVisible();
    await ownerPage.getByTestId("share-add-toggle").click();
    await ownerPage.getByTestId("share-login").fill(memberLogin);
    await ownerPage.getByTestId("share-add").click();
    await expect(ownerPage.getByTestId("share-members")).toContainText(memberLogin, {
      timeout: 10_000,
    });

    await expect(
      memberPage.getByTestId("list-note-title").filter({ hasText: title }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(memberPage.getByTestId("shared-note-badge").first()).toContainText(
      `Общая · владелец: ${ownerLogin}`,
    );

    await memberPage.getByTestId("list-note-main").filter({ hasText: title }).click();
    await expect(memberPage.getByTestId("note-form")).toBeVisible();
    const edited = `${title} by member`;
    await memberPage.getByTestId("note-title").fill(edited);
    await expect(memberPage.getByTestId("note-save-status")).toContainText("Сохранено", {
      timeout: 10_000,
    });

    // Owner still on note page — list proves the edit without relying on open editor sync.
    await ownerPage.goto("/list");
    await expect(
      ownerPage.getByTestId("list-note-title").filter({ hasText: edited }),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await ownerCtx.close();
    await memberCtx.close();
  }
});

test("e2e_share_participant_stack", async ({ browser }) => {
  const ownerLogin = uniqueLogin("owns");
  const memA = uniqueLogin("msa");
  const memB = uniqueLogin("msb");
  const title = `Stack ${Date.now().toString(36)}`;

  const ownerCtx = await browser.newContext();
  const memACtx = await browser.newContext();
  const memBCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  const memAPage = await memACtx.newPage();

  try {
    await apiRegister(ownerCtx.request, ownerLogin);
    await apiRegister(memACtx.request, memA);
    await apiRegister(memBCtx.request, memB);
    await loginUi(ownerPage, ownerLogin);
    await loginUi(memAPage, memA);

    const note = await apiCreateNote(ownerCtx.request, {
      title,
      body: "group",
      starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      reminder_offsets: [],
      tag_ids: [],
    });

    await ownerPage.goto(`/notes/${note.id}`);
    for (const login of [memA, memB]) {
      await ownerPage.getByTestId("share-add-toggle").click();
      await ownerPage.getByTestId("share-login").fill(login);
      await ownerPage.getByTestId("share-add").click();
      await expect(ownerPage.getByTestId(`share-remove-${login}`)).toBeVisible({
        timeout: 10_000,
      });
    }
    await expect(ownerPage.getByTestId("participant-stack")).toBeVisible();
    await expect(ownerPage.getByTestId("participant-stack-avatar")).toHaveCount(3);

    await memAPage.goto(`/notes/${note.id}`);
    await expect(memAPage.getByTestId("participant-stack")).toBeVisible({ timeout: 10_000 });
    await expect(memAPage.getByTestId("participant-stack-avatar")).toHaveCount(3);
    await expect(
      memAPage.locator(`[data-testid="participant-stack-avatar"][data-login="${memB}"]`),
    ).toHaveCount(1);
    await expect(
      memAPage.locator(`[data-testid="participant-stack-avatar"][data-login="${ownerLogin}"]`),
    ).toHaveCount(1);
    await expect(memAPage.getByTestId("leave-note")).toBeVisible();
  } finally {
    await ownerCtx.close();
    await memACtx.close();
    await memBCtx.close();
  }
});

test("e2e_share_contact_pills_and_suggestions", async ({ browser }) => {
  const ownerLogin = uniqueLogin("ownc");
  const memberLogin = uniqueLogin("memc");
  const titleA = `ShareA ${Date.now().toString(36)}`;
  const titleB = `ShareB ${Date.now().toString(36)}`;

  const ownerCtx = await browser.newContext();
  const memberCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();

  try {
    await apiRegister(ownerCtx.request, ownerLogin);
    await apiRegister(memberCtx.request, memberLogin);
    await loginUi(ownerPage, ownerLogin);

    const noteA = await apiCreateNote(ownerCtx.request, {
      title: titleA,
      body: "a",
      starts_at: new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      reminder_offsets: [],
      tag_ids: [],
    });

    await ownerPage.goto(`/notes/${noteA.id}`);
    await ownerPage.getByTestId("share-add-toggle").click();
    await ownerPage.getByTestId("share-login").fill(memberLogin);
    await ownerPage.getByTestId("share-add").click();
    await expect(
      ownerPage.getByTestId("share-members").getByTestId("contact-pill-member"),
    ).toContainText(memberLogin, { timeout: 10_000 });
    // Added member = filled pill; not in suggestions for this note.
    await expect(ownerPage.getByTestId(`share-suggest-${memberLogin}`)).toHaveCount(0);

    const noteB = await apiCreateNote(ownerCtx.request, {
      title: titleB,
      body: "b",
      starts_at: new Date(Date.now() + 7200_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      reminder_offsets: [],
      tag_ids: [],
    });
    await ownerPage.goto(`/notes/${noteB.id}`);
    await expect(ownerPage.getByTestId("share-suggestions")).toBeVisible();
    const suggest = ownerPage.getByTestId(`share-suggest-${memberLogin}`);
    await expect(suggest).toBeVisible();
    await expect(suggest).toHaveClass(/contact-pill-suggestion/);
    await suggest.click();
    await expect(
      ownerPage.getByTestId("share-members").getByTestId("contact-pill-member"),
    ).toContainText(memberLogin, { timeout: 10_000 });
    await expect(ownerPage.getByTestId(`share-suggest-${memberLogin}`)).toHaveCount(0);
  } finally {
    await ownerCtx.close();
    await memberCtx.close();
  }
});
