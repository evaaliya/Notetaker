import { Recurrence } from "../api";

type Props = {
  value: Recurrence | null;
  onChange: (value: Recurrence | null) => void;
  timeZone: string;
  /** When editing an existing series master — show read-only summary. */
  lockedTz?: string | null;
};

export function RecurrenceField({ value, onChange, timeZone, lockedTz }: Props) {
  const enabled = value != null;
  const freq = value?.freq ?? "daily";
  const until = value?.until ?? "";

  return (
    <fieldset className="tag-pick" data-testid="recurrence-field">
      <legend>Повтор</legend>
      <label className="inline">
        <input
          type="checkbox"
          data-testid="recurrence-enabled"
          checked={enabled}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { freq: "daily", until: null, tz: lockedTz || timeZone }
                : null,
            )
          }
        />
        Повторять
      </label>
      {enabled && (
        <>
          <label>
            Частота
            <select
              data-testid="recurrence-freq"
              value={freq}
              onChange={(e) =>
                onChange({
                  freq: e.target.value as Recurrence["freq"],
                  until: value?.until ?? null,
                  tz: value?.tz ?? lockedTz ?? timeZone,
                })
              }
            >
              <option value="daily">каждый день</option>
              <option value="weekly">каждую неделю</option>
              <option value="monthly">каждый месяц</option>
            </select>
          </label>
          <label>
            До даты (включительно)
            <input
              type="date"
              data-testid="recurrence-until"
              value={until ?? ""}
              onChange={(e) =>
                onChange({
                  freq,
                  until: e.target.value || null,
                  tz: value?.tz ?? lockedTz ?? timeZone,
                })
              }
            />
          </label>
          <p className="muted small" data-testid="recurrence-tz">
            Пояс серии: {value?.tz ?? lockedTz ?? timeZone} (замораживается при создании)
          </p>
        </>
      )}
    </fieldset>
  );
}
