/** Format UTC ISO timestamps in the user's IANA timezone (spec §4.5). */

/**
 * Short weekday labels Mon→Пн … Sun→Вс (luxon weekday 1–7).
 * UI language is Russian (FRONTEND §1); do not use English Mon/Tue.
 */
export const WEEKDAY_SHORT_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/** Wall-clock time always as HH:MM (24h) in ``timeZone`` — calendar / list / upcoming. */
export function formatTimeHm(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

const FREQ_LABEL: Record<string, string> = {
  daily: "каждый день",
  weekly: "каждую неделю",
  monthly: "каждый месяц",
};

/** Human-readable series summary for the side panel (no occurrence keys). */
export function formatSeriesRecurrenceHint(
  freq: string | null | undefined,
  until: string | null | undefined,
): string {
  const freqLabel = (freq && FREQ_LABEL[freq]) || "с повтором";
  if (!until) {
    return `Повторяется ${freqLabel}`;
  }
  // rec_until is a calendar date (YYYY-MM-DD); show as DD.MM.YYYY.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until);
  const untilLabel = m ? `${m[3]}.${m[2]}.${m[1]}` : until;
  return `Повторяется ${freqLabel} до ${untilLabel}`;
}

/** Date + HH:MM in ``timeZone`` (no AM/PM, minutes always shown). */
export function formatInZone(
  iso: string,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (options) {
    return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone }).format(new Date(iso));
  }
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** Local datetime-local value → UTC ISO Z for API. */
export function localInputToUtcIso(localValue: string, timeZone: string): string {
  // Interpret the wall time in user TZ, emit UTC.
  // Approach: format parts via Temporal-less heuristic — build as if local, adjust by offset.
  const [datePart, timePart] = localValue.split("T");
  if (!datePart || !timePart) {
    throw new Error("invalid datetime-local");
  }
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  // Guess UTC instant, then refine using the zone's offset at that instant.
  let guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    const desired = Date.UTC(y, m - 1, d, hh, mm);
    guess += desired - asUtc;
  }
  return new Date(guess).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Move an instant to a new calendar day in `timeZone`, keeping wall-clock time.
 * Used by calendar drag-and-drop (spec §6).
 */
export function relocateKeepWallTime(
  startsAtIso: string,
  dropInstant: Date,
  timeZone: string,
): string {
  const wall = utcIsoToLocalInput(startsAtIso, timeZone);
  const timePart = wall.split("T")[1] ?? "00:00";
  const dropLocal = utcIsoToLocalInput(dropInstant.toISOString(), timeZone);
  const datePart = dropLocal.split("T")[0];
  return localInputToUtcIso(`${datePart}T${timePart}`, timeZone);
}

/**
 * Move to ``dayKey`` + ``hour`` in ``timeZone``, keeping the original minutes
 * (e.g. 14:35 → hour 16 → 16:35). Used by week/day timeline DnD.
 */
export function relocateToLocalHourKeepingMinutes(
  startsAtIso: string,
  dayKey: string,
  hour: number,
  timeZone: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error("invalid dayKey");
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("invalid hour");
  }
  const wall = utcIsoToLocalInput(startsAtIso, timeZone);
  const minutes = (wall.split("T")[1] ?? "00:00").split(":")[1] ?? "00";
  const hh = String(hour).padStart(2, "0");
  return localInputToUtcIso(`${dayKey}T${hh}:${minutes}`, timeZone);
}

/** Change calendar day only; keep HH:MM wall time in ``timeZone``. */
export function relocateToLocalDayKeepingTime(
  startsAtIso: string,
  dayKey: string,
  timeZone: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error("invalid dayKey");
  }
  const wall = utcIsoToLocalInput(startsAtIso, timeZone);
  const timePart = wall.split("T")[1] ?? "00:00";
  return localInputToUtcIso(`${dayKey}T${timePart}`, timeZone);
}

/** Start of local calendar day (00:00) → UTC ISO Z for list ``from``. */
export function localDateStartToUtcIso(dateYmd: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    throw new Error("invalid date");
  }
  return localInputToUtcIso(`${dateYmd}T00:00`, timeZone);
}

/** End of local calendar day (23:59) → UTC ISO Z for list ``to`` (inclusive minutes). */
export function localDateEndToUtcIso(dateYmd: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    throw new Error("invalid date");
  }
  return localInputToUtcIso(`${dateYmd}T23:59`, timeZone);
}

/** UTC ISO → value for <input type="datetime-local"> in user TZ. */
export function utcIsoToLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
