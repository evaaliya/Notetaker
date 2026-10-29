export type UiPrefs = {
  sound: boolean;
  /** Repeat melody every ~4s until muted. Default on. */
  soundRepeat: boolean;
  bellAnim: boolean;
};

const KEY = "notetaker.uiPrefs";

const DEFAULTS: UiPrefs = { sound: true, soundRepeat: true, bellAnim: true };

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      sound: parsed.sound ?? DEFAULTS.sound,
      soundRepeat: parsed.soundRepeat ?? DEFAULTS.soundRepeat,
      bellAnim: parsed.bellAnim ?? DEFAULTS.bellAnim,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
