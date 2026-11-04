import { useMemo, useState, type RefObject } from "react";
import { DateTime } from "luxon";
import type { Note, Occurrence, Tag } from "../../api";
import { formatTimeHm } from "../../format";
import { occKey } from "../../lib/calendar/groupByLocalDay";
import { MAX_VISIBLE_IN_CLUSTER } from "../../lib/calendar/timelineLayout";
import { TimelineNoteCard } from "./TimelineNoteCard";

export type AgendaVariant = "day" | "week";

type Props = {
  dayKey: string;
  weekdayLabel: string;
  occs: Occurrence[];
  tags: Tag[];
  timeZone: string;
  /** day = full 24h spine by default; week = compact default spine */
  variant?: AgendaVariant;
  onSelect: (occ: Occurrence) => void;
  dndEnabled?: boolean;
  trashZoneRef?: RefObject<HTMLElement | null>;
  onDraggingChange?: (dragging: boolean, overTrash: boolean) => void;
  onDropRelocate?: (note: Note, starts_at: string, originalStart: string | null) => void;
  onTrashDrop?: (occ: Occurrence) => void;
  onDropError?: (msg: string) => void;
};

type HourMark = { kind: "hour"; key: string; labelHm: string; hour: number };
type NoteMark = {
  kind: "note";
  key: string;
  labelHm: string;
  hour: number;
  occ: Occurrence;
  overflowHidden: Occurrence[];
  overflowAll: Occurrence[];
};
type Mark = HourMark | NoteMark;

function sortOccs(occs: Occurrence[], timeZone: string): Occurrence[] {
  return [...occs].sort((a, b) => {
    const ma = DateTime.fromISO(a.occurrence_start, { zone: "utc" }).setZone(timeZone);
    const mb = DateTime.fromISO(b.occurrence_start, { zone: "utc" }).setZone(timeZone);
    if (ma.toMillis() !== mb.toMillis()) return ma.toMillis() - mb.toMillis();
    return occKey(a) < occKey(b) ? -1 : 1;
  });
}

function clusterOccs(occs: Occurrence[], timeZone: string): Occurrence[][] {
  const sorted = sortOccs(occs, timeZone);
  const groups: Occurrence[][] = [];
  for (const occ of sorted) {
    const last = groups[groups.length - 1];
    if (!last) {
      groups.push([occ]);
      continue;
    }
    const a = DateTime.fromISO(last[0].occurrence_start, { zone: "utc" }).setZone(timeZone);
    const b = DateTime.fromISO(occ.occurrence_start, { zone: "utc" }).setZone(timeZone);
    if (Math.abs(b.diff(a, "minutes").minutes) <= 20) last.push(occ);
    else groups.push([occ]);
  }
  return groups;
}

function noteFlatRows(occs: Occurrence[], timeZone: string): NoteMark[] {
  const clusters = clusterOccs(occs, timeZone);
  const rows: NoteMark[] = [];
  for (const group of clusters) {
    const visible = group.slice(0, MAX_VISIBLE_IN_CLUSTER);
    const hidden = group.slice(MAX_VISIBLE_IN_CLUSTER);
    visible.forEach((occ, i) => {
      const hour = DateTime.fromISO(occ.occurrence_start, { zone: "utc" }).setZone(timeZone)
        .hour;
      rows.push({
        kind: "note",
        key: occKey(occ),
        labelHm: formatTimeHm(occ.occurrence_start, timeZone),
        hour,
        occ,
        overflowHidden: i === visible.length - 1 ? hidden : [],
        overflowAll: group,
      });
    });
  }
  return rows;
}

/** Day: 24 hour ticks; notes replace the hour tick of their hour (and elongate the spine). */
function buildDayMarks(occs: Occurrence[], timeZone: string): Mark[] {
  const byHour = new Map<number, Occurrence[]>();
  for (const occ of sortOccs(occs, timeZone)) {
    const h = DateTime.fromISO(occ.occurrence_start, { zone: "utc" }).setZone(timeZone).hour;
    const list = byHour.get(h) ?? [];
    list.push(occ);
    byHour.set(h, list);
  }

  const marks: Mark[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const hourOccs = byHour.get(hour);
    if (hourOccs && hourOccs.length > 0) {
      marks.push(...noteFlatRows(hourOccs, timeZone));
    } else {
      marks.push({
        kind: "hour",
        key: `h-${hour}`,
        labelHm: `${String(hour).padStart(2, "0")}:00`,
        hour,
      });
    }
  }
  return marks;
}

/**
 * Week: note rows + default hour slots without notes (drop targets for time moves).
 * Empty day → compact spine 06/09/12/15/18/21.
 */
function buildWeekMarks(occs: Occurrence[], timeZone: string): Mark[] {
  const defaults = [6, 9, 12, 15, 18, 21];
  if (occs.length === 0) {
    return defaults.map((hour) => ({
      kind: "hour" as const,
      key: `h-${hour}`,
      labelHm: `${String(hour).padStart(2, "0")}:00`,
      hour,
    }));
  }
  const noteRows = noteFlatRows(occs, timeZone);
  const hoursWithNotes = new Set(noteRows.map((r) => r.hour));
  const marks: Mark[] = [...noteRows];
  for (const hour of defaults) {
    if (hoursWithNotes.has(hour)) continue;
    marks.push({
      kind: "hour",
      key: `h-${hour}`,
      labelHm: `${String(hour).padStart(2, "0")}:00`,
      hour,
    });
  }
  marks.sort((a, b) => {
    if (a.hour !== b.hour) return a.hour - b.hour;
    if (a.kind !== b.kind) return a.kind === "note" ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });
  return marks;
}

export function AgendaDaySection({
  dayKey,
  weekdayLabel,
  occs,
  tags,
  timeZone,
  variant = "week",
  onSelect,
  dndEnabled = false,
  trashZoneRef,
  onDraggingChange,
  onDropRelocate,
  onTrashDrop,
  onDropError,
}: Props) {
  const dt = DateTime.fromISO(dayKey, { zone: timeZone });
  const isToday = DateTime.now().setZone(timeZone).toISODate() === dayKey;
  const marks = useMemo(
    () => (variant === "day" ? buildDayMarks(occs, timeZone) : buildWeekMarks(occs, timeZone)),
    [variant, occs, timeZone],
  );
  const [openCluster, setOpenCluster] = useState<string | null>(null);

  return (
    <section
      className={`tl-agenda-day tl-agenda-${variant}${isToday ? " tl-agenda-day-today" : ""}`}
      data-testid="tl-day"
      data-day={dayKey}
      data-cal-drop-day={dayKey}
      data-variant={variant}
    >
      <div className="tl-agenda-date" data-testid="tl-day-heading">
        <span className={`tl-agenda-num${isToday ? " on" : ""}`}>{dt.day}</span>
        <span className="tl-agenda-wd">{weekdayLabel}</span>
      </div>

      <div className="tl-agenda-track">
        <ul
          className="tl-agenda-list"
          data-testid={variant === "day" ? "tl-hours" : "tl-week-spine"}
        >
          {marks.map((mark, idx) => {
            const hasMoreBelow = idx < marks.length - 1;
            const isNote = mark.kind === "note";
            return (
              <li
                key={mark.key}
                className={`tl-agenda-row${isNote ? " tl-agenda-row-note" : " tl-agenda-row-hour"}`}
                data-cal-drop-day={dayKey}
                data-cal-drop-hour={String(mark.hour)}
                data-testid={isNote ? "tl-drop-note" : "tl-drop-hour"}
              >
                <span className="tl-agenda-hm">{mark.labelHm}</span>
                <div className="tl-agenda-spine">
                  {hasMoreBelow ? (
                    <span className="tl-agenda-line" aria-hidden="true" />
                  ) : (
                    <span className="tl-agenda-line tl-agenda-line-end" aria-hidden="true" />
                  )}
                  <span className="tl-agenda-dot" aria-hidden="true" />
                </div>
                <div className="tl-agenda-card-wrap">
                  {isNote ? (
                    <>
                      <TimelineNoteCard
                        occ={mark.occ}
                        tags={tags}
                        timeZone={timeZone}
                        onSelect={onSelect}
                        dndEnabled={dndEnabled}
                        trashZoneRef={trashZoneRef}
                        onDraggingChange={onDraggingChange}
                        onDropRelocate={onDropRelocate}
                        onTrashDrop={onTrashDrop}
                        onDropError={onDropError}
                      />
                      {mark.overflowHidden.length > 0 && (
                        <div className="tl-overflow tl-overflow-flow">
                          <button
                            type="button"
                            className="tl-overflow-btn"
                            data-testid="tl-overflow-btn"
                            onClick={() =>
                              setOpenCluster((k) => (k === mark.key ? null : mark.key))
                            }
                          >
                            +{mark.overflowHidden.length} ещё
                          </button>
                          {openCluster === mark.key && (
                            <ul className="tl-overflow-list" data-testid="tl-overflow-list">
                              {mark.overflowAll.map((o) => (
                                <li key={occKey(o)}>
                                  <button
                                    type="button"
                                    data-testid="tl-overflow-item"
                                    data-occ-key={occKey(o)}
                                    onClick={() => {
                                      onSelect(o);
                                      setOpenCluster(null);
                                    }}
                                  >
                                    <span className="muted">
                                      {formatTimeHm(o.occurrence_start, timeZone)}
                                    </span>{" "}
                                    {o.note.title || "Без названия"}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="tl-agenda-hour-gap" aria-hidden="true" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
