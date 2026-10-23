/** Format UTC ISO timestamps in the user's IANA timezone (spec §4.5). */

export function formatInZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(new Date(iso));
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
