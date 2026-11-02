import { DateTime } from "luxon";
import type { Occurrence } from "../../api";

export type CalView = "month" | "week" | "day";

export function occKey(occ: Occurrence): string {
  return `${occ.note.id}:${occ.original_start}`;
}

export function localDayKey(iso: string, timeZone: string): string {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(timeZone).toFormat("yyyy-MM-dd");
}

/** Month FC pill: timed start + end clamped to the same local day (D-104). */
export function monthPillRange(
  occurrenceStart: string,
  timeZone: string,
  durationMin = 30,
): { start: string; end: string } {
  const start = DateTime.fromISO(occurrenceStart, { zone: "utc" }).setZone(timeZone);
  const dayEnd = start.endOf("day");
  let end = start.plus({ minutes: durationMin });
  if (end > dayEnd) end = dayEnd;
  if (end <= start) end = DateTime.min(start.plus({ minutes: 1 }), dayEnd);
  const toZ = (dt: DateTime) =>
    dt.toUTC().toISO({ suppressMilliseconds: true })!.replace(/\+00:00$/, "Z");
  return { start: toZ(start), end: toZ(end) };
}

/** Earliest created_at, then note id — stable default main pill. */
export function compareCreated(a: Occurrence, b: Occurrence): number {
  const ca = a.note.created_at;
  const cb = b.note.created_at;
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0;
}

export function groupByLocalDay(
  items: Occurrence[],
  timeZone: string,
): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const it of items) {
    const key = localDayKey(it.occurrence_start, timeZone);
    const list = map.get(key);
    if (list) list.push(it);
    else map.set(key, [it]);
  }
  for (const list of map.values()) {
    list.sort(compareCreated);
  }
  return map;
}

export function pickMainOcc(
  dayOccs: Occurrence[],
  sessionKey: string | undefined,
): Occurrence | null {
  if (dayOccs.length === 0) return null;
  if (sessionKey) {
    const found = dayOccs.find((o) => occKey(o) === sessionKey);
    if (found) return found;
  }
  return [...dayOccs].sort(compareCreated)[0] ?? null;
}

export function rangeForView(
  view: CalView,
  anchorIsoDay: string,
  timeZone: string,
): { from: string; to: string; title: string } {
  const anchor = DateTime.fromISO(anchorIsoDay, { zone: timeZone }).startOf("day");
  if (view === "day") {
    const from = anchor.toUTC();
    const to = anchor.plus({ days: 1 }).toUTC();
    return {
      from: toIsoZ(from),
      to: toIsoZ(to),
      title: anchor.setLocale("ru").toFormat("d MMMM yyyy"),
    };
  }
  if (view === "week") {
    // ISO week: Monday start (luxon default).
    const start = anchor.startOf("week");
    const end = start.plus({ days: 7 });
    const title =
      start.month === end.minus({ days: 1 }).month
        ? `${start.setLocale("ru").toFormat("d")} – ${end.minus({ days: 1 }).setLocale("ru").toFormat("d MMMM yyyy")}`
        : `${start.setLocale("ru").toFormat("d MMM")} – ${end.minus({ days: 1 }).setLocale("ru").toFormat("d MMM yyyy")}`;
    return { from: toIsoZ(start.toUTC()), to: toIsoZ(end.toUTC()), title };
  }
  // Month: pad to full weeks for FC (from start of week containing 1st to end after last).
  const monthStart = anchor.startOf("month");
  const monthEnd = anchor.endOf("month").startOf("day");
  const from = monthStart.startOf("week");
  const to = monthEnd.endOf("week").plus({ days: 1 }).startOf("day");
  return {
    from: toIsoZ(from.toUTC()),
    to: toIsoZ(to.toUTC()),
    title: anchor.setLocale("ru").toFormat("LLLL yyyy"),
  };
}

export function shiftAnchor(view: CalView, anchorIsoDay: string, timeZone: string, dir: -1 | 1): string {
  const a = DateTime.fromISO(anchorIsoDay, { zone: timeZone }).startOf("day");
  const next =
    view === "day"
      ? a.plus({ days: dir })
      : view === "week"
        ? a.plus({ weeks: dir })
        : a.plus({ months: dir });
  return next.toISODate()!;
}

export function todayAnchor(timeZone: string): string {
  return DateTime.now().setZone(timeZone).toISODate()!;
}

function toIsoZ(dt: DateTime): string {
  return dt.toUTC().toISO({ suppressMilliseconds: true })!.replace(/\+00:00$/, "Z");
}

export function weekDays(anchorIsoDay: string, timeZone: string): string[] {
  const start = DateTime.fromISO(anchorIsoDay, { zone: timeZone }).startOf("week");
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toISODate()!);
}
