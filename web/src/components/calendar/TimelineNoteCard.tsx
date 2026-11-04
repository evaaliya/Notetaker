import type { CSSProperties, RefObject } from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DateTime } from "luxon";
import type { Note, Occurrence, Tag } from "../../api";
import { formatTimeHm } from "../../format";
import { useLongPressDrag } from "../../hooks/useLongPressDrag";
import { resolveCalDropTarget, startsAtForTimelineDrop } from "../../lib/calendar/dnd";
import { tagColors } from "../../lib/tagColors";
import { occKey } from "../../lib/calendar/groupByLocalDay";

/** Visual end when note has no ends_at: +30 minutes (display only). */
const DEFAULT_DURATION_MIN = 30;

type Props = {
  occ: Occurrence;
  tags: Tag[];
  timeZone: string;
  onSelect: (occ: Occurrence) => void;
  dndEnabled?: boolean;
  trashZoneRef?: RefObject<HTMLElement | null>;
  onDraggingChange?: (dragging: boolean, overTrash: boolean) => void;
  onDropRelocate?: (note: Note, starts_at: string, originalStart: string | null) => void;
  onTrashDrop?: (occ: Occurrence) => void;
  onDropError?: (msg: string) => void;
};

function firstTag(occ: Occurrence, tags: Tag[]): Tag | undefined {
  const id = occ.note.tag_ids[0];
  return id ? tags.find((t) => t.id === id) : undefined;
}

export function eventTimeRangeLabel(startIso: string, timeZone: string): string {
  const start = DateTime.fromISO(startIso, { zone: "utc" }).setZone(timeZone);
  const end = start.plus({ minutes: DEFAULT_DURATION_MIN });
  const a = formatTimeHm(startIso, timeZone);
  const b = end.toFormat("HH:mm");
  return `${a}–${b}`;
}

export function TimelineNoteCard({
  occ,
  tags,
  timeZone,
  onSelect,
  dndEnabled = false,
  trashZoneRef,
  onDraggingChange,
  onDropRelocate,
  onTrashDrop,
  onDropError,
}: Props) {
  const tag = firstTag(occ, tags);
  const colors = tagColors(tag?.color);
  const title = occ.note.title || "Без названия";
  const hm = formatTimeHm(occ.occurrence_start, timeZone);
  const range = eventTimeRangeLabel(occ.occurrence_start, timeZone);
  /** null = ghost not mounted (avoids stuck pill at 0,0). */
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [ghostSize, setGhostSize] = useState<{ w: number; h: number } | null>(null);
  const [cardEl, setCardEl] = useState<HTMLButtonElement | null>(null);

  const clearDragChrome = useCallback(() => {
    setGhostPos(null);
    setGhostSize(null);
    document.body.classList.remove("cal-dnd-active");
    onDraggingChange?.(false, false);
  }, [onDraggingChange]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("cal-dnd-active");
    };
  }, []);

  const { bind, suppressClickIfDragged } = useLongPressDrag({
    enabled: dndEnabled,
    onArmed: (x, y) => {
      onDraggingChange?.(true, false);
      if (cardEl) {
        const r = cardEl.getBoundingClientRect();
        setGhostSize({ w: r.width, h: r.height });
      }
      setGhostPos({ x: x + 8, y: y + 8 });
      document.body.classList.add("cal-dnd-active");
    },
    onMove: (x, y) => {
      setGhostPos({ x: x + 8, y: y + 8 });
      const target = resolveCalDropTarget(x, y, trashZoneRef?.current ?? null);
      onDraggingChange?.(true, target?.kind === "trash");
    },
    onEnd: (x, y) => {
      clearDragChrome();
      const target = resolveCalDropTarget(x, y, trashZoneRef?.current ?? null);
      if (!target) return;
      if (target.kind === "trash") {
        onTrashDrop?.(occ);
        return;
      }
      try {
        const starts_at = startsAtForTimelineDrop(occ, target, timeZone);
        if (starts_at === occ.occurrence_start) return;
        onDropRelocate?.(
          occ.note,
          starts_at,
          occ.note.rec_freq ? occ.original_start : null,
        );
      } catch (err) {
        onDropError?.(err instanceof Error ? err.message : String(err));
      }
    },
    onCancel: () => {
      clearDragChrome();
    },
  });

  const tagStyle = {
    "--tag-bg": colors.fill,
    "--tag-fg": colors.ink,
  } as CSSProperties;

  return (
    <>
      <button
        type="button"
        ref={setCardEl}
        className={`tl-card${dndEnabled ? " tl-card-dnd" : ""}${ghostPos ? " is-dragging" : ""}`}
        data-testid="tl-card"
        data-occ-key={occKey(occ)}
        data-hm={hm}
        title={dndEnabled ? `${title} · удерживайте, чтобы перенести` : title}
        style={tagStyle}
        {...bind}
        onClick={() => {
          if (suppressClickIfDragged()) return;
          onSelect(occ);
        }}
      >
        <span className="tl-card-range">{range}</span>
        <span className="tl-card-title">{title}</span>
      </button>
      {dndEnabled &&
        ghostPos &&
        createPortal(
          <div
            className="tl-card tl-dnd-ghost is-visible"
            data-testid="tl-dnd-ghost"
            aria-hidden="true"
            style={{
              ...tagStyle,
              transform: `translate(${ghostPos.x}px, ${ghostPos.y}px)`,
              ...(ghostSize
                ? { width: ghostSize.w, height: ghostSize.h, minWidth: ghostSize.w }
                : null),
            }}
          >
            <span className="tl-card-range">{range}</span>
            <span className="tl-card-title">{title}</span>
          </div>,
          document.body,
        )}
    </>
  );
}
