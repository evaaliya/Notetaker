export type UiPrefs = {
  sound: boolean;
  bellAnim: boolean;
};

const KEY = "notetaker.uiPrefs";

const DEFAULTS: UiPrefs = { sound: true, bellAnim: true };

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      sound: parsed.sound ?? DEFAULTS.sound,
      bellAnim: parsed.bellAnim ?? DEFAULTS.bellAnim,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveUiPrefs(prefs: UiPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
