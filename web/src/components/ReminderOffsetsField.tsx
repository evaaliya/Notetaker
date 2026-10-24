import { localInputToUtcIso } from "../format";

/** Preset reminder offsets from the assignment: 10 min / 1 hour / 1 day. */

export const REMINDER_OPTIONS = [
  { minutes: 10, label: "за 10 минут" },
  { minutes: 60, label: "за час" },
  { minutes: 1440, label: "за день" },
] as const;

type Props = {
  value: number[];
  onChange: (next: number[]) => void;
  /** datetime-local wall time in ``timeZone`` — for past-fire warnings. */
  startsLocal?: string;
  timeZone?: string;
  now?: Date;
};

export function reminderFireIsPast(
  startsLocal: string,
  timeZone: string,
  offsetMin: number,
  now: Date = new Date(),
): boolean {
  try {
    const startsMs = new Date(localInputToUtcIso(startsLocal, timeZone)).getTime();
    if (!Number.isFinite(startsMs)) return false;
    return startsMs - offsetMin * 60_000 <= now.getTime();
  } catch {
    return false;
  }
}

export function ReminderOffsetsField({
  value,
  onChange,
  startsLocal,
  timeZone,
  now,
}: Props) {
  function toggle(minutes: number) {
    if (value.includes(minutes)) {
      onChange(value.filter((m) => m !== minutes));
    } else {
      onChange([...value, minutes].sort((a, b) => a - b));
    }
  }

  const clock = now ?? new Date();
  const canWarn = Boolean(startsLocal && timeZone);

  return (
    <fieldset className="tag-pick" data-testid="reminder-offsets">
      <legend>Напоминания</legend>
      {REMINDER_OPTIONS.map((opt) => {
        const checked = value.includes(opt.minutes);
        const past =
          canWarn &&
          checked &&
          reminderFireIsPast(startsLocal!, timeZone!, opt.minutes, clock);
        return (
          <label key={opt.minutes} className="inline reminder-opt">
            <input
              type="checkbox"
              data-testid={`reminder-offset-${opt.minutes}`}
              checked={checked}
              onChange={() => toggle(opt.minutes)}
            />
            <span>
              {opt.label}
              {past && (
                <span className="reminder-past" data-testid="reminder-past-warning">
                  {" "}
                  — это напоминание уже не сработает
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function offsetsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}
