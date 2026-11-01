import { useMemo, useState, type ReactNode } from "react";
import { DateTime } from "luxon";
import type { Occurrence, Tag } from "../../api";
import { formatTimeHm } from "../../format";
import {
  DAY_HEIGHT_PX,
  hourMarks,
  layoutDayTimeline,
} from "../../lib/calendar/timelineLayout";
import { occKey } from "../../lib/calendar/groupByLocalDay";
import { TimelineNoteCard } from "./TimelineNoteCard";

type Props = {
  dayKey: string;
  occs: Occurrence[];
  tags: Tag[];
  timeZone: string;
  showHours: boolean;
  heading?: ReactNode;
  onSelect: (occ: Occurrence) => void;
};

export function DayTimeline({
  dayKey,
  occs,
  tags,
  timeZone,
  showHours,
  heading,
  onSelect,
}: Props) {
  const { cards, clusters } = useMemo(
    () => layoutDayTimeline(occs, timeZone),
    [occs, timeZone],
  );
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const marks = useMemo(() => hourMarks(), []);
  const isToday =
    DateTime.now().setZone(timeZone).toISODate() === dayKey;

  return (
    <div
      className={`tl-day${isToday ? " tl-day-today" : ""}`}
      data-testid="tl-day"
      data-day={dayKey}
    >
      {heading}
      <div className="tl-day-body">
        {showHours && (
          <div className="tl-hours" aria-hidden="true" data-testid="tl-hours">
            {marks.map((m) => (
              <div key={m.hour} className="tl-hour" style={{ top: m.top }}>
                {m.label}
              </div>
            ))}
          </div>
        )}
        <div className="tl-rail-wrap" style={{ height: DAY_HEIGHT_PX }}>
          <div className="tl-rail" aria-hidden="true" />
          {cards.map((c) => (
            <div key={occKey(c.occ)} className="tl-dot-row" style={{ top: c.top + 10 }}>
              <span className="tl-dot" />
            </div>
          ))}
          <div className="tl-cards">
            {cards.map((c) => (
              <TimelineNoteCard
                key={occKey(c.occ)}
                occ={c.occ}
                tags={tags}
                timeZone={timeZone}
                top={c.top}
                height={c.height}
                onSelect={onSelect}
              />
            ))}
            {clusters.map((cl) => (
              <div
                key={cl.clusterKey}
                className="tl-overflow"
                style={{ top: cl.overflowTop }}
              >
                <button
                  type="button"
                  className="tl-overflow-btn"
                  data-testid="tl-overflow-btn"
                  data-cluster={cl.clusterKey}
                  onClick={() =>
                    setOpenCluster((k) => (k === cl.clusterKey ? null : cl.clusterKey))
                  }
                >
                  +{cl.hidden.length} ещё
                </button>
                {openCluster === cl.clusterKey && (
                  <ul className="tl-overflow-list" data-testid="tl-overflow-list">
                    {[...cl.visible.map((v) => v.occ), ...cl.hidden].map((occ) => (
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
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
