import type { CSSProperties, RefObject } from "react";
import { useCallback, useRef } from "react";
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
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const updateGhost = useCallback((x: number, y: number) => {
    const g = ghostRef.current;
    if (!g) return;
    g.style.transform = `translate(${x + 8}px, ${y + 8}px)`;
    g.hidden = false;
  }, []);

  const hideGhost = useCallback(() => {
    const g = ghostRef.current;
    if (!g) return;
    g.hidden = true;
  }, []);

  const { bind, suppressClickIfDragged } = useLongPressDrag({
    enabled: dndEnabled,
    onArmed: (x, y) => {
      onDraggingChange?.(true, false);
      updateGhost(x, y);
      document.body.classList.add("cal-dnd-active");
    },
    onMove: (x, y) => {
      updateGhost(x, y);
      const target = resolveCalDropTarget(x, y, trashZoneRef?.current ?? null);
      onDraggingChange?.(true, target?.kind === "trash");
    },
    onEnd: (x, y) => {
      hideGhost();
      document.body.classList.remove("cal-dnd-active");
      onDraggingChange?.(false, false);
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
      hideGhost();
      document.body.classList.remove("cal-dnd-active");
      onDraggingChange?.(false, false);
    },
  });

  return (
    <>
      <button
        type="button"
        className={`tl-card${dndEnabled ? " tl-card-dnd" : ""}`}
        data-testid="tl-card"
        data-occ-key={occKey(occ)}
        data-hm={hm}
        title={dndEnabled ? `${title} · удерживайте, чтобы перенести` : title}
        style={
          {
            "--tag-bg": colors.fill,
            "--tag-fg": colors.ink,
          } as CSSProperties
        }
        {...bind}
        onClick={() => {
          if (suppressClickIfDragged()) return;
          onSelect(occ);
        }}
      >
        <span className="tl-card-range">{range}</span>
        <span className="tl-card-title">{title}</span>
      </button>
      {dndEnabled ? (
        <div
          ref={ghostRef}
          className="tl-dnd-ghost"
          data-testid="tl-dnd-ghost"
          hidden
          aria-hidden="true"
        >
          <span className="tl-card-range">{range}</span>
          <span className="tl-card-title">{title}</span>
        </div>
      ) : null}
    </>
  );
}
