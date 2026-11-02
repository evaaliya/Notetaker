import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Occurrence, Tag } from "../../api";
import { tagColors } from "../../lib/tagColors";
import { formatTimeHm } from "../../format";
import { occKey } from "../../lib/calendar/groupByLocalDay";

const MAX_SEGMENTS = 8;
/** Comfortable reading width; clamped to viewport (D-112). */
const POPOVER_TARGET_W = 320;
const POPOVER_MIN_W = 240;
const VIEW_PAD = 8;

type Props = {
  dayKey: string;
  occs: Occurrence[];
  tags: Tag[];
  mainKey: string | null;
  timeZone: string;
  onSelect: (occ: Occurrence) => void;
};

type PopPos = { top: number; left: number; width: number; maxHeight: number };

function firstTagColor(occ: Occurrence, tags: Tag[]): string {
  const id = occ.note.tag_ids[0];
  const tag = id ? tags.find((t) => t.id === id) : undefined;
  return tagColors(tag?.color).ink;
}

function placePopover(anchor: DOMRect): PopPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(POPOVER_TARGET_W, Math.max(POPOVER_MIN_W, vw - VIEW_PAD * 2));
  let left = anchor.left;
  if (left + width > vw - VIEW_PAD) left = vw - width - VIEW_PAD;
  if (left < VIEW_PAD) left = VIEW_PAD;

  const below = vh - anchor.bottom - VIEW_PAD;
  const above = anchor.top - VIEW_PAD;
  const preferBelow = below >= 140 || below >= above;
  let maxHeight = Math.min(280, preferBelow ? below : above);
  if (maxHeight < 96) maxHeight = Math.max(96, Math.min(280, Math.max(below, above)));
  const top = preferBelow
    ? anchor.bottom + 4
    : Math.max(VIEW_PAD, anchor.top - 4 - maxHeight);

  return { top, left, width, maxHeight };
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
  const [pos, setPos] = useState<PopPos | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const popId = useId();

  useLayoutEffect(() => {
    if (!open || !moreRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      if (!moreRef.current) return;
      setPos(placePopover(moreRef.current.getBoundingClientRect()));
    };
    update();
    window.addEventListener("resize", update);
    // Capture scroll in FC scroller / page so popover stays aligned or we re-place.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, occs.length]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (moreRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
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
            ref={moreRef}
            type="button"
            className="month-day-seg-more"
            data-testid="month-day-seg-more"
            aria-label={`Ещё ${more} заметок`}
            aria-expanded={open}
            aria-controls={open ? popId : undefined}
            onClick={() => setOpen((v) => !v)}
          >
            +{more}
          </button>
        )}
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            id={popId}
            className="month-day-seg-popover"
            ref={popRef}
            data-testid="month-day-seg-popover"
            role="dialog"
            aria-label="Заметки дня"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
          >
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
                    <span className="month-day-seg-popover-time muted">
                      {formatTimeHm(occ.occurrence_start, timeZone)}
                    </span>
                    <span className="month-day-seg-popover-title">
                      {occ.note.title || "Без названия"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
