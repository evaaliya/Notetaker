import { expect, test } from "@playwright/test";
import {
  createAlarmLoop,
  type AlarmAudioContext,
  DEFAULT_REPEAT_EVERY_MS,
} from "../src/lib/alarmLoop";
import {
  apiCreateNote,
  apiRegister,
  loginUi,
  uniqueLogin,
  waitForWsReady,
} from "./helpers";

test("alarmLoop_starts_repeats_and_stops", async () => {
  type Pending = { id: number; fn: () => void; ms: number };
  const pending: Pending[] = [];
  let nextId = 1;
  let oscStarts = 0;

  const fakeCtx: AlarmAudioContext = {
    currentTime: 0,
    state: "running",
    destination: {},
    resume: async () => {
      fakeCtx.state = "running";
    },
    createOscillator: () => {
      const osc = {
        type: "sine",
        frequency: { value: 0 },
        connect: () => undefined,
        start: () => {
          oscStarts += 1;
        },
        stop: () => undefined,
      };
      return osc;
    },
    createGain: () => ({
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    }),
  };

  const loop = createAlarmLoop({
    createAudioContext: () => fakeCtx,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      pending.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      const i = pending.findIndex((p) => p.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    channel: null,
    storage: null,
    tabId: "test-tab",
    repeatEveryMs: DEFAULT_REPEAT_EVERY_MS,
  });

  const unlocked = await loop.unlock();
  expect(unlocked).toBe(true);

  const started = loop.start({ repeat: true });
  expect(started.blocked).toBe(false);
  expect(started.audible).toBe(true);
  expect(loop.isPlaying()).toBe(true);
  expect(oscStarts).toBe(3); // three-note melody

  // One repeat timer scheduled (~4s).
  expect(pending).toHaveLength(1);
  expect(pending[0].ms).toBe(DEFAULT_REPEAT_EVERY_MS);

  const firstTimer = pending[0];
  pending.splice(0, 1);
  firstTimer.fn();
  expect(oscStarts).toBe(6);
  expect(loop.isPlaying()).toBe(true);
  expect(pending).toHaveLength(1);

  loop.stop();
  expect(loop.isPlaying()).toBe(false);
  expect(pending).toHaveLength(0);

  // Firing a stale callback must not restart after stop.
  const staleStarts = oscStarts;
  firstTimer.fn();
  expect(oscStarts).toBe(staleStarts);
  expect(loop.isPlaying()).toBe(false);
});

test("e2e_alarm_stops_on_dismiss", async ({ page, request }) => {
  const login = uniqueLogin("alarm");
  await apiRegister(request, login);
  const note = await apiCreateNote(request, {
    title: "Alarm mute",
    body: "chime",
    starts_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    reminder_offsets: [10],
    tag_ids: [],
  });

  await loginUi(page, login);
  await waitForWsReady(page);
  // Unlock AudioContext with a user gesture before the reminder fires.
  await page.locator("body").click({ position: { x: 8, y: 8 } });

  const due = await page.request.post("/api/e2e/make_reminder_due", {
    data: { note_id: note.id },
  });
  expect(due.ok(), await due.text()).toBeTruthy();
  const tick = await page.request.post("/api/e2e/tick_reminders");
  expect(tick.ok(), await tick.text()).toBeTruthy();

  const toast = page.getByTestId("toast").filter({ hasText: "Alarm mute" });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Выключить звук" })).toBeVisible();
  await expect(page.getByTestId("alarm-playing")).toBeVisible();

  await toast.getByRole("button", { name: "Выключить звук" }).click();
  await expect(page.getByTestId("alarm-playing")).toHaveCount(0);
});
