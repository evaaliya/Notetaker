import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { Occurrence, Tag } from "../../api";
import { formatTimeHm } from "../../format";
import { occKey } from "../../lib/calendar/groupByLocalDay";
import { MAX_VISIBLE_IN_CLUSTER } from "../../lib/calendar/timelineLayout";
import { TimelineNoteCard } from "./TimelineNoteCard";

type Props = {
  dayKey: string;
  weekdayLabel: string;
  occs: Occurrence[];
  tags: Tag[];
  timeZone: string;
  onSelect: (occ: Occurrence) => void;
};

function sortOccs(occs: Occurrence[], timeZone: string): Occurrence[] {
  return [...occs].sort((a, b) => {
    const ma = DateTime.fromISO(a.occurrence_start, { zone: "utc" }).setZone(timeZone);
    const mb = DateTime.fromISO(b.occurrence_start, { zone: "utc" }).setZone(timeZone);
    if (ma.toMillis() !== mb.toMillis()) return ma.toMillis() - mb.toMillis();
    return occKey(a) < occKey(b) ? -1 : 1;
  });
}

/** Group near-simultaneous notes for overflow chip. */
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

export function AgendaDaySection({
  dayKey,
  weekdayLabel,
  occs,
  tags,
  timeZone,
  onSelect,
}: Props) {
  const dt = DateTime.fromISO(dayKey, { zone: timeZone });
  const isToday = DateTime.now().setZone(timeZone).toISODate() === dayKey;
  const clusters = useMemo(() => clusterOccs(occs, timeZone), [occs, timeZone]);
  const [openCluster, setOpenCluster] = useState<string | null>(null);

  const flatRows: {
    key: string;
    labelHm: string;
    occ: Occurrence;
    overflowHidden: Occurrence[];
    overflowAll: Occurrence[];
  }[] = [];

  for (const group of clusters) {
    const visible = group.slice(0, MAX_VISIBLE_IN_CLUSTER);
    const hidden = group.slice(MAX_VISIBLE_IN_CLUSTER);
    visible.forEach((occ, i) => {
      flatRows.push({
        key: occKey(occ),
        labelHm: formatTimeHm(occ.occurrence_start, timeZone),
        occ,
        overflowHidden: i === visible.length - 1 ? hidden : [],
        overflowAll: group,
      });
    });
  }

  return (
    <section
      className={`tl-agenda-day${isToday ? " tl-agenda-day-today" : ""}`}
      data-testid="tl-day"
      data-day={dayKey}
    >
      <div className="tl-agenda-date" data-testid="tl-day-heading">
        <span className={`tl-agenda-num${isToday ? " on" : ""}`}>{dt.day}</span>
        <span className="tl-agenda-wd">{weekdayLabel}</span>
      </div>

      <div className="tl-agenda-track">
        {flatRows.length > 0 && (
          <ul className="tl-agenda-list">
            {flatRows.map((row, idx) => {
              const hasMoreBelow = idx < flatRows.length - 1 || row.overflowHidden.length > 0;
              return (
                <li key={row.key} className="tl-agenda-row">
                  <span className="tl-agenda-hm">{row.labelHm}</span>
                  <div className="tl-agenda-spine">
                    {hasMoreBelow ? (
                      <span className="tl-agenda-line" aria-hidden="true" />
                    ) : null}
                    <span className="tl-agenda-dot" aria-hidden="true" />
                  </div>
                  <div className="tl-agenda-card-wrap">
                    <TimelineNoteCard
                      occ={row.occ}
                      tags={tags}
                      timeZone={timeZone}
                      onSelect={onSelect}
                    />
                    {row.overflowHidden.length > 0 && (
                      <div className="tl-overflow tl-overflow-flow">
                        <button
                          type="button"
                          className="tl-overflow-btn"
                          data-testid="tl-overflow-btn"
                          onClick={() =>
                            setOpenCluster((k) => (k === row.key ? null : row.key))
                          }
                        >
                          +{row.overflowHidden.length} ещё
                        </button>
                        {openCluster === row.key && (
                          <ul className="tl-overflow-list" data-testid="tl-overflow-list">
                            {row.overflowAll.map((occ) => (
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
