import type { Occurrence } from "../../api";
import {
  relocateToLocalDayKeepingTime,
  relocateToLocalHourKeepingMinutes,
} from "../../format";

/** Long-press before drag arms — avoids accidental move while scrolling (touch). */
export const DND_LONG_PRESS_MS = 350;
/** Pointer travel before long-press cancels drag (treat as scroll/tap). */
export const DND_MOVE_CANCEL_PX = 10;

export type CalDropTarget =
  | { kind: "trash" }
  | { kind: "slot"; dayKey: string; hour: number }
  | { kind: "day"; dayKey: string };

/** Resolve drop under the pointer (trash zone, hour row, or day section). */
export function resolveCalDropTarget(
  clientX: number,
  clientY: number,
  trashZone: HTMLElement | null,
): CalDropTarget | null {
  if (trashZone) {
    const r = trashZone.getBoundingClientRect();
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return { kind: "trash" };
    }
  }
  const el = document.elementFromPoint(clientX, clientY);
  if (!el || !(el instanceof Element)) return null;
  if (el.closest('[data-cal-drop="trash"]')) {
    return { kind: "trash" };
  }
  const hourHost = el.closest("[data-cal-drop-hour]");
  if (hourHost) {
    const dayKey = hourHost.getAttribute("data-cal-drop-day");
    const hourRaw = hourHost.getAttribute("data-cal-drop-hour");
    if (dayKey && hourRaw != null && hourRaw !== "") {
      const hour = Number(hourRaw);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
        return { kind: "slot", dayKey, hour };
      }
    }
  }
  const dayHost = el.closest("[data-cal-drop-day]");
  if (dayHost) {
    const dayKey = dayHost.getAttribute("data-cal-drop-day");
    if (dayKey) return { kind: "day", dayKey };
  }
  return null;
}

/** Compute new ``starts_at`` for a timeline drop (not trash). */
export function startsAtForTimelineDrop(
  occ: Occurrence,
  target: Exclude<CalDropTarget, { kind: "trash" }>,
  timeZone: string,
): string {
  if (target.kind === "slot") {
    return relocateToLocalHourKeepingMinutes(
      occ.occurrence_start,
      target.dayKey,
      target.hour,
      timeZone,
    );
  }
  return relocateToLocalDayKeepingTime(occ.occurrence_start, target.dayKey, timeZone);
}
