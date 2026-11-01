import { DateTime } from "luxon";
import type { Occurrence, Tag } from "../../api";
import { groupByLocalDay } from "../../lib/calendar/groupByLocalDay";
import { AgendaDaySection } from "./AgendaDaySection";

type Props = {
  dayKey: string;
  items: Occurrence[];
  tags: Tag[];
  timeZone: string;
  onSelect: (occ: Occurrence) => void;
};

const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DayTimelineView({ dayKey, items, tags, timeZone, onSelect }: Props) {
  const byDay = groupByLocalDay(items, timeZone);
  const occs = byDay.get(dayKey) ?? [];
  const dt = DateTime.fromISO(dayKey, { zone: timeZone });
  // luxon weekday: 1=Mon … 7=Sun
  const wd = WEEKDAYS_SHORT[dt.weekday - 1];

  return (
    <div className="tl-day-view tl-week-agenda" data-testid="tl-day-view">
      <AgendaDaySection
        dayKey={dayKey}
        weekdayLabel={wd}
        occs={occs}
        tags={tags}
        timeZone={timeZone}
        variant="day"
        onSelect={onSelect}
      />
    </div>
  );
}
