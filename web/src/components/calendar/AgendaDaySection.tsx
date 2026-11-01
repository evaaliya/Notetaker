import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { Occurrence, Tag } from "../../api";
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
};

type HourMark = { kind: "hour"; key: string; labelHm: string; hour: number };
type NoteMark = {
  kind: "note";
  key: string;
  labelHm: string;
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

function noteFlatRows(
  occs: Occurrence[],
  timeZone: string,
): NoteMark[] {
  const clusters = clusterOccs(occs, timeZone);
  const rows: NoteMark[] = [];
  for (const group of clusters) {
    const visible = group.slice(0, MAX_VISIBLE_IN_CLUSTER);
    const hidden = group.slice(MAX_VISIBLE_IN_CLUSTER);
    visible.forEach((occ, i) => {
      rows.push({
        kind: "note",
        key: occKey(occ),
        labelHm: formatTimeHm(occ.occurrence_start, timeZone),
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

/** Week: notes if any; otherwise compact default spine with circles. */
function buildWeekMarks(occs: Occurrence[], timeZone: string): Mark[] {
  if (occs.length > 0) return noteFlatRows(occs, timeZone);
  // Default circles along the day (morning → evening).
  return [6, 9, 12, 15, 18, 21].map((hour) => ({
    kind: "hour" as const,
    key: `h-${hour}`,
    labelHm: `${String(hour).padStart(2, "0")}:00`,
    hour,
  }));
}

export function AgendaDaySection({
  dayKey,
  weekdayLabel,
  occs,
  tags,
  timeZone,
  variant = "week",
  onSelect,
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
                              {mark.overflowAll.map((occ) => (
                                <li key={occKey(occ)}>
                                  <button
                                    type="button"
                                    data-testid="tl-overflow-item"
                                    data-occ-key={occKey(occ)}
                                    onClick={() => {
                                      onSelect(occ);
                                      setOpenCluster(null);
                                    }}
                                  >
                                    <span className="muted">
                                      {formatTimeHm(occ.occurrence_start, timeZone)}
                                    </span>{" "}
                                    {occ.note.title || "Без названия"}
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
