/** Preset reminder offsets from the assignment: 10 min / 1 hour / 1 day. */

export const REMINDER_OPTIONS = [
  { minutes: 10, label: "за 10 минут" },
  { minutes: 60, label: "за час" },
  { minutes: 1440, label: "за день" },
] as const;

type Props = {
  value: number[];
  onChange: (next: number[]) => void;
};

export function ReminderOffsetsField({ value, onChange }: Props) {
  function toggle(minutes: number) {
    if (value.includes(minutes)) {
      onChange(value.filter((m) => m !== minutes));
    } else {
      onChange([...value, minutes].sort((a, b) => a - b));
    }
  }

  return (
    <fieldset className="tag-pick" data-testid="reminder-offsets">
      <legend>Напоминания</legend>
      {REMINDER_OPTIONS.map((opt) => (
        <label key={opt.minutes} className="inline">
          <input
            type="checkbox"
            data-testid={`reminder-offset-${opt.minutes}`}
            checked={value.includes(opt.minutes)}
            onChange={() => toggle(opt.minutes)}
          />
          {opt.label}
        </label>
      ))}
    </fieldset>
  );
}

export function offsetsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}
