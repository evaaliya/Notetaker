import { useEffect, useState } from "react";

/**
 * Live clock for bucket transitions (spec §5).
 * Wakes at the nearest starts_at, every 30s, and when the tab regains focus.
 */
export function useNow(nearestStartsAt: string | null | undefined): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number | undefined;

    const tick = () => setNow(new Date());

    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      const delays: number[] = [30_000];
      if (nearestStartsAt) {
        const ms = new Date(nearestStartsAt).getTime() - Date.now();
        if (ms > 0 && Number.isFinite(ms)) {
          delays.push(ms + 25);
        }
      }
      timer = window.setTimeout(() => {
        tick();
        schedule();
      }, Math.min(...delays));
    };

    schedule();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        tick();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [nearestStartsAt]);

  return now;
}
