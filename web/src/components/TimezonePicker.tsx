import { useEffect, useMemo, useRef, useState } from "react";

function allTimeZones(): string[] {
  try {
    // ES2022 — available in modern Chromium/Firefox/Safari.
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
      "timeZone",
    );
  } catch {
    return [
      "UTC",
      "Asia/Bishkek",
      "Europe/Moscow",
      "Europe/Berlin",
      "America/New_York",
      "America/Los_Angeles",
      "Asia/Tokyo",
    ];
  }
}

const ZONES = allTimeZones();

type Props = {
  value: string;
  onChange: (tz: string) => void;
};

/** Searchable IANA timezone picker (not a 400-row &lt;select&gt;). */
export function TimezonePicker({ value, onChange }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ZONES.filter((z) => z.toLowerCase().includes(q)) : ZONES;
    return list.slice(0, 40);
  }, [query]);

  function pick(tz: string) {
    onChange(tz);
    setQuery(tz);
    setOpen(false);
  }

  function onBlurCommit() {
    const exact = ZONES.find((z) => z.toLowerCase() === query.trim().toLowerCase());
    if (exact) {
      onChange(exact);
      setQuery(exact);
    } else {
      setQuery(value);
    }
  }

  return (
    <div className="tz-picker" ref={wrapRef} data-testid="timezone-picker">
      <div className="tz-picker-control">
        <input
          data-testid="settings-timezone"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="tz-picker-list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={onBlurCommit}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && matches[0]) {
              e.preventDefault();
              pick(matches[0]);
            }
          }}
          placeholder="Начните вводить, напр. Asia/Bishkek"
          autoComplete="off"
          required
        />
        {open && matches.length > 0 && (
          <ul id="tz-picker-list" className="tz-picker-list" role="listbox">
            {matches.map((z) => (
              <li key={z}>
                <button
                  type="button"
                  role="option"
                  aria-selected={z === value}
                  className={z === value ? "active" : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(z)}
                >
                  {z}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="muted small">Поиск по всем IANA-поясам ({ZONES.length}).</p>
    </div>
  );
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
