/** Two-tone chime via Web Audio (no asset files). FRONTEND §8. */

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Call on first user gesture so later notification sounds are allowed. */
export function unlockNotifyAudio(): void {
  const c = getCtx();
  if (!c) return;
  void c.resume().then(() => {
    unlocked = true;
  });
}

export function playNotifyChime(): void {
  const c = getCtx();
  if (!c || !unlocked) return;
  try {
    const now = c.currentTime;
    tone(c, 880, now, 0.09);
    tone(c, 1174.7, now + 0.1, 0.12);
  } catch {
    /* autoplay / closed context — ignore */
  }
}

function tone(c: AudioContext, freq: number, start: number, dur: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}
