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

  await apiRegister(ownerCtx.request, ownerLogin);
  await apiRegister(memberCtx.request, memberLogin);

  await loginUi(ownerPage, ownerLogin);
  await loginUi(memberPage, memberLogin);
  await waitForWsReady(ownerPage);
  await waitForWsReady(memberPage);

  const note = await apiCreateNote(ownerCtx.request, {
    title,
    body: "shared body",
    starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reminder_offsets: [],
    tag_ids: [],
  });

  const shareRes = await ownerCtx.request.post(`/api/notes/${note.id}/members`, {
    data: { login: memberLogin },
  });
  expect(shareRes.ok(), await shareRes.text()).toBeTruthy();

  await memberPage.goto("/list");
  await expect(memberPage.getByTestId("list-note-title").filter({ hasText: title })).toBeVisible({
    timeout: 15_000,
  });
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

  await ownerPage.goto("/list");
  await expect(ownerPage.getByTestId("list-note-title").filter({ hasText: edited })).toBeVisible({
    timeout: 15_000,
  });

  await ownerCtx.close();
  await memberCtx.close();
});
