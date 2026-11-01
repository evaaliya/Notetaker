import type { Occurrence, Tag } from "../../api";
import { groupByLocalDay } from "../../lib/calendar/groupByLocalDay";
import { DayTimeline } from "./DayTimeline";

type Props = {
  dayKey: string;
  items: Occurrence[];
  tags: Tag[];
  timeZone: string;
  onSelect: (occ: Occurrence) => void;
};

export function DayTimelineView({ dayKey, items, tags, timeZone, onSelect }: Props) {
  const byDay = groupByLocalDay(items, timeZone);
  const occs = byDay.get(dayKey) ?? [];

  return (
    <div className="tl-day-view" data-testid="tl-day-view">
      <DayTimeline
        dayKey={dayKey}
        occs={occs}
        tags={tags}
        timeZone={timeZone}
        showHours
        onSelect={onSelect}
      />
    </div>
  );
}
