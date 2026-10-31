const KEY = "notetaker.sidebarCollapsed";

/** Default collapsed (Claude-like). */
export function loadSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}
