import { DateTime } from "luxon";
import type { Occurrence } from "../../api";
import { occKey } from "./groupByLocalDay";

/** Pixels for a full local day on the timeline. */
export const DAY_HEIGHT_PX = 24 * 48; // 48px per hour

export const MAX_VISIBLE_IN_CLUSTER = 4;
export const CLUSTER_GAP_MIN = 20; // minutes → same cluster if within this
export const CARD_MIN_H = 36;

export type LaidOutCard = {
  occ: Occurrence;
  top: number;
  height: number;
  /** Hidden behind "+N ещё" when cluster overflows. */
  overflow: boolean;
};

export type TimelineCluster = {
  visible: LaidOutCard[];
  hidden: Occurrence[];
  /** Top of the overflow chip (px). */
  overflowTop: number;
  clusterKey: string;
};

export function minutesFromMidnight(iso: string, timeZone: string): number {
  const local = DateTime.fromISO(iso, { zone: "utc" }).setZone(timeZone);
  return local.hour * 60 + local.minute + local.second / 60;
}

export function topForMinutes(minutes: number): number {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, minutes));
  return (clamped / (24 * 60)) * DAY_HEIGHT_PX;
}

/**
 * Layout notes along a day timeline. Same-time / near notes form clusters;
 * at most MAX_VISIBLE_IN_CLUSTER shown, rest go to overflow list.
 */
export function layoutDayTimeline(
  occs: Occurrence[],
  timeZone: string,
): { cards: LaidOutCard[]; clusters: TimelineCluster[] } {
  const sorted = [...occs].sort((a, b) => {
    const ma = minutesFromMidnight(a.occurrence_start, timeZone);
    const mb = minutesFromMidnight(b.occurrence_start, timeZone);
    if (ma !== mb) return ma - mb;
    return occKey(a) < occKey(b) ? -1 : 1;
  });

  const clustersRaw: Occurrence[][] = [];
  for (const occ of sorted) {
    const m = minutesFromMidnight(occ.occurrence_start, timeZone);
    const last = clustersRaw[clustersRaw.length - 1];
    if (
      last &&
      Math.abs(m - minutesFromMidnight(last[0].occurrence_start, timeZone)) <= CLUSTER_GAP_MIN
    ) {
      last.push(occ);
    } else {
      clustersRaw.push([occ]);
    }
  }

  const cards: LaidOutCard[] = [];
  const clusters: TimelineCluster[] = [];

  for (const group of clustersRaw) {
    const visibleOccs = group.slice(0, MAX_VISIBLE_IN_CLUSTER);
    const hidden = group.slice(MAX_VISIBLE_IN_CLUSTER);
    const baseTop = topForMinutes(minutesFromMidnight(group[0].occurrence_start, timeZone));
    // Keep cluster within day bounds.
    const maxTop = DAY_HEIGHT_PX - CARD_MIN_H;
    let cursor = Math.min(baseTop, maxTop);

    const visible: LaidOutCard[] = [];
    for (const occ of visibleOccs) {
      const top = Math.min(cursor, maxTop);
      const card: LaidOutCard = {
        occ,
        top,
        height: CARD_MIN_H,
        overflow: false,
      };
      visible.push(card);
      cards.push(card);
      cursor = top + CARD_MIN_H + 4;
      if (cursor > maxTop) cursor = maxTop;
    }

    if (hidden.length > 0) {
      const overflowTop = Math.min(
        (visible[visible.length - 1]?.top ?? baseTop) + CARD_MIN_H + 4,
        maxTop,
      );
      clusters.push({
        visible,
        hidden,
        overflowTop,
        clusterKey: occKey(group[0]),
      });
    }
  }

  return { cards, clusters };
}

export function hourMarks(): { hour: number; label: string; top: number }[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    top: topForMinutes(hour * 60),
  }));
}
