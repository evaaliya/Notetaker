import { useEffect, useRef, useState } from "react";
import type { Occurrence, Tag } from "../../api";
import { tagColors } from "../../lib/tagColors";
import { formatTimeHm } from "../../format";
import { occKey } from "../../lib/calendar/groupByLocalDay";

const MAX_SEGMENTS = 8;

type Props = {
  dayKey: string;
  occs: Occurrence[];
  tags: Tag[];
  mainKey: string | null;
  timeZone: string;
  onSelect: (occ: Occurrence) => void;
};

function firstTagColor(occ: Occurrence, tags: Tag[]): string {
  const id = occ.note.tag_ids[0];
  const tag = id ? tags.find((t) => t.id === id) : undefined;
  return tagColors(tag?.color).ink;
}

export function MonthDaySegments({
  dayKey,
  occs,
  tags,
  mainKey,
  timeZone,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (occs.length <= 1) return null;

  const overflow = occs.length > MAX_SEGMENTS;
  const visible = overflow ? occs.slice(0, MAX_SEGMENTS - 1) : occs;
  const more = overflow ? occs.length - visible.length : 0;

  return (
    <div
      className="month-day-segments"
      data-testid="month-day-segments"
      data-day={dayKey}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="month-day-sausage" role="list" aria-label="Заметки дня">
        {visible.map((occ) => {
          const key = occKey(occ);
          const active = key === mainKey;
          return (
            <button
              key={key}
              type="button"
              role="listitem"
              className={`month-day-seg${active ? " on" : ""}`}
              style={{ background: firstTagColor(occ, tags) }}
              title={occ.note.title || "Без названия"}
              aria-label={occ.note.title || "Без названия"}
              aria-pressed={active}
              data-testid="month-day-seg"
              data-occ-key={key}
              onClick={() => onSelect(occ)}
            />
          );
        })}
        {more > 0 && (
          <button
            type="button"
            className="month-day-seg-more"
            data-testid="month-day-seg-more"
            aria-label={`Ещё ${more} заметок`}
            onClick={() => setOpen((v) => !v)}
          >
            +{more}
          </button>
        )}
      </div>
      {open && (
        <div className="month-day-seg-popover" ref={popRef} data-testid="month-day-seg-popover">
          <ul>
            {occs.map((occ) => (
              <li key={occKey(occ)}>
                <button
                  type="button"
                  data-testid="month-day-seg-popover-item"
                  data-occ-key={occKey(occ)}
                  onClick={() => {
                    onSelect(occ);
                    setOpen(false);
                  }}
                >
                  <span className="muted">{formatTimeHm(occ.occurrence_start, timeZone)}</span>{" "}
                  {occ.note.title || "Без названия"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
