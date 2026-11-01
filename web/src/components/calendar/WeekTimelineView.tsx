import { DateTime } from "luxon";
import type { Occurrence, Tag } from "../../api";
import { groupByLocalDay, weekDays } from "../../lib/calendar/groupByLocalDay";
import { DayTimeline } from "./DayTimeline";

type Props = {
  anchorIsoDay: string;
  items: Occurrence[];
  tags: Tag[];
  timeZone: string;
  stacked: boolean;
  onSelect: (occ: Occurrence) => void;
};

const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export function WeekTimelineView({
  anchorIsoDay,
  items,
  tags,
  timeZone,
  stacked,
  onSelect,
}: Props) {
  const days = weekDays(anchorIsoDay, timeZone);
  const byDay = groupByLocalDay(items, timeZone);

  return (
    <div
      className={`tl-week${stacked ? " tl-week-stacked" : ""}`}
      data-testid="tl-week"
    >
      {days.map((dayKey, idx) => {
        const dt = DateTime.fromISO(dayKey, { zone: timeZone });
        const heading = (
          <div className="tl-day-heading" data-testid="tl-day-heading">
            <span className="tl-day-num">{dt.day}</span>
            <span className="tl-day-wd">{WEEKDAYS_SHORT[idx]}</span>
          </div>
        );
        return (
          <DayTimeline
            key={dayKey}
            dayKey={dayKey}
            occs={byDay.get(dayKey) ?? []}
            tags={tags}
            timeZone={timeZone}
            showHours
            heading={heading}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}
