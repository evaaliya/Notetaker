/**
 * Soft 3-note ascending chime via Web Audio (no asset files).
 * Repeats until stopped; one audible tab via BroadcastChannel + localStorage.
 */

export type AlarmStartOpts = {
  /** When false, play the melody once. Default true. */
  repeat?: boolean;
};

export type AlarmStartResult = {
  /** This tab is producing (or will produce) audible output. */
  audible: boolean;
  /** AudioContext blocked until a user gesture. */
  blocked: boolean;
};

export type AlarmChannel = {
  postMessage: (data: unknown) => void;
  addEventListener: (
    type: "message",
    listener: (ev: MessageEvent | { data: unknown }) => void,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (ev: MessageEvent | { data: unknown }) => void,
  ) => void;
  close?: () => void;
};

/** Minimal AudioContext surface used by the melody. */
export type AlarmAudioContext = {
  currentTime: number;
  state: string;
  destination: unknown;
  resume: () => Promise<void>;
  createOscillator: () => {
    type: string;
    frequency: { value: number };
    connect: (dest: unknown) => void;
    start: (when?: number) => void;
    stop: (when?: number) => void;
  };
  createGain: () => {
    gain: {
      setValueAtTime: (v: number, t: number) => void;
      exponentialRampToValueAtTime: (v: number, t: number) => void;
    };
    connect: (dest: unknown) => void;
  };
};

export type AlarmLoopDeps = {
  createAudioContext?: () => AlarmAudioContext | null;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
  /** Multi-tab bus; pass `null` to disable (single-tab / unit tests). */
  channel?: AlarmChannel | null;
  tabId?: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  melodyMs?: number;
  repeatEveryMs?: number;
};

type BusMsg =
  | { type: "claim"; tabId: string }
  | { type: "stop" }
  | { type: "playing"; tabId: string };

const STORAGE_KEY = "notetaker.alarm.owner";
const CHANNEL_NAME = "notetaker.alarm";

/** Soft ascending triad, ~3s with fade. */
const NOTES: { freq: number; offset: number; dur: number; peak: number }[] = [
  { freq: 523.25, offset: 0.0, dur: 0.85, peak: 0.11 }, // C5
  { freq: 659.25, offset: 0.65, dur: 0.9, peak: 0.1 }, // E5
  { freq: 783.99, offset: 1.3, dur: 1.5, peak: 0.09 }, // G5
];

export const DEFAULT_MELODY_MS = 3000;
export const DEFAULT_REPEAT_EVERY_MS = 4000;

function defaultCreateContext(): AlarmAudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  return new AC() as unknown as AlarmAudioContext;
}

function defaultChannel(): AlarmChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function playMelody(ctx: AlarmAudioContext): void {
  const t0 = ctx.currentTime + 0.02;
  for (const n of NOTES) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    const start = t0 + n.offset;
    const end = start + n.dur;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(n.peak, start + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.05);
  }
}

export type AlarmLoop = {
  unlock: () => Promise<boolean>;
  isUnlocked: () => boolean;
  start: (opts?: AlarmStartOpts) => AlarmStartResult;
  stop: () => void;
  isPlaying: () => boolean;
  subscribe: (cb: (playing: boolean) => void) => () => void;
};

export function createAlarmLoop(deps: AlarmLoopDeps = {}): AlarmLoop {
  const schedule =
    deps.setTimeout ??
    ((fn, ms) => window.setTimeout(fn, ms) as unknown as number);
  const cancel = deps.clearTimeout ?? ((id) => window.clearTimeout(id));
  const createCtx = deps.createAudioContext ?? defaultCreateContext;
  const melodyMs = deps.melodyMs ?? DEFAULT_MELODY_MS;
  const repeatEveryMs = deps.repeatEveryMs ?? DEFAULT_REPEAT_EVERY_MS;
  const tabId =
    deps.tabId ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tab-${Math.random().toString(36).slice(2)}`);
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const channel = deps.channel === undefined ? defaultChannel() : deps.channel;

  let ctx: AlarmAudioContext | null = null;
  let unlocked = false;
  let playing = false;
  let repeat = true;
  let amLeader = false;
  let timerId: number | null = null;
  const listeners = new Set<(playing: boolean) => void>();

  function emit() {
    for (const cb of listeners) cb(playing);
  }

  function setPlaying(v: boolean) {
    if (playing === v) return;
    playing = v;
    emit();
  }

  function ensureCtx(): AlarmAudioContext | null {
    if (!ctx) ctx = createCtx();
    return ctx;
  }

  function clearTimer() {
    if (timerId != null) {
      cancel(timerId);
      timerId = null;
    }
  }

  function claimLeadership(): boolean {
    if (!storage) return true;
    try {
      const cur = storage.getItem(STORAGE_KEY);
      if (cur && cur !== tabId) return false;
      storage.setItem(STORAGE_KEY, tabId);
      return storage.getItem(STORAGE_KEY) === tabId;
    } catch {
      return true;
    }
  }

  function releaseLeadership() {
    if (!storage) return;
    try {
      if (storage.getItem(STORAGE_KEY) === tabId) storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function stopLocal() {
    clearTimer();
    amLeader = false;
    setPlaying(false);
  }

  function scheduleNext() {
    clearTimer();
    if (!repeat || !amLeader) return;
    timerId = schedule(() => {
      timerId = null;
      if (!amLeader || !repeat) return;
      runCycle();
    }, repeatEveryMs);
  }

  function runCycle() {
    const c = ensureCtx();
    if (!c || !unlocked) {
      setPlaying(false);
      return;
    }
    if (c.state !== "running") {
      setPlaying(false);
      return;
    }
    try {
      playMelody(c);
      setPlaying(true);
      channel?.postMessage({ type: "playing", tabId } satisfies BusMsg);
      if (repeat) {
        scheduleNext();
      } else {
        timerId = schedule(() => {
          timerId = null;
          setPlaying(false);
          amLeader = false;
          releaseLeadership();
        }, melodyMs);
      }
    } catch {
      setPlaying(false);
    }
  }

  function onBus(raw: unknown) {
    const msg = raw as BusMsg | null;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "stop") {
      stopLocal();
      return;
    }
    if (msg.type === "claim" && msg.tabId !== tabId && !amLeader) {
      stopLocal();
    }
  }

  const onMessage = (ev: MessageEvent | { data: unknown }) => onBus(ev.data);
  channel?.addEventListener("message", onMessage);

  function onStorage(ev: StorageEvent) {
    if (ev.key !== STORAGE_KEY) return;
    if (ev.newValue == null || ev.newValue === "") {
      stopLocal();
    } else if (ev.newValue !== tabId) {
      stopLocal();
    }
  }
  if (typeof window !== "undefined" && storage && storage === localStorage) {
    window.addEventListener("storage", onStorage);
  }

  async function unlock(): Promise<boolean> {
    const c = ensureCtx();
    if (!c) return false;
    try {
      await c.resume();
    } catch {
      return false;
    }
    unlocked = c.state === "running";
    return unlocked;
  }

  function start(opts: AlarmStartOpts = {}): AlarmStartResult {
    repeat = opts.repeat !== false;

    const c = ensureCtx();
    if (!c || !unlocked || c.state !== "running") {
      return { audible: false, blocked: true };
    }

    if (amLeader && playing) {
      return { audible: true, blocked: false };
    }

    if (!claimLeadership()) {
      amLeader = false;
      setPlaying(false);
      return { audible: false, blocked: false };
    }

    amLeader = true;
    channel?.postMessage({ type: "claim", tabId } satisfies BusMsg);
    clearTimer();
    runCycle();
    return { audible: true, blocked: false };
  }

  function stop() {
    const wasLeader = amLeader;
    stopLocal();
    if (wasLeader) releaseLeadership();
    else if (storage) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    channel?.postMessage({ type: "stop" } satisfies BusMsg);
  }

  return {
    unlock,
    isUnlocked: () => unlocked,
    start,
    stop,
    isPlaying: () => playing,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/** App singleton. */
let singleton: AlarmLoop | null = null;

export function getAlarmLoop(): AlarmLoop {
  if (!singleton) singleton = createAlarmLoop();
  return singleton;
}

/** Reset singleton (unit tests). */
export function resetAlarmLoopForTests(): void {
  singleton = null;
}

/** Call on first user gesture so later notification sounds are allowed. */
export function unlockNotifyAudio(): void {
  void getAlarmLoop().unlock();
}
