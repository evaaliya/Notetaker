/**
 * Opt-in render counter for M15 Profiler measurements.
 * Enable: localStorage.setItem("m15.profile", "1"); location.reload()
 * Read: window.__m15Renders
 */
export type RenderBucket = "upcoming" | "list" | "calendar" | "useNow";

declare global {
  interface Window {
    __m15Renders?: Record<string, { count: number; totalMs: number; lastMs: number }>;
  }
}

export function profileEnabled(): boolean {
  try {
    return localStorage.getItem("m15.profile") === "1";
  } catch {
    return false;
  }
}

export function recordRender(bucket: RenderBucket, durationMs: number): void {
  if (typeof window === "undefined" || !profileEnabled()) return;
  const store = (window.__m15Renders ??= {});
  const cur = store[bucket] ?? { count: 0, totalMs: 0, lastMs: 0 };
  cur.count += 1;
  cur.totalMs += durationMs;
  cur.lastMs = durationMs;
  store[bucket] = cur;
}
