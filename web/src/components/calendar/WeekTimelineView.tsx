import type { Occurrence, Tag } from "../../api";
import { groupByLocalDay, weekDays } from "../../lib/calendar/groupByLocalDay";
import { AgendaDaySection } from "./AgendaDaySection";

type Props = {
  anchorIsoDay: string;
  items: Occurrence[];
  tags: Tag[];
  timeZone: string;
  /** @deprecated always stacked like the reference agenda */
  stacked?: boolean;
  onSelect: (occ: Occurrence) => void;
};

/** English short weekdays as on the reference screenshot (layout exact). */
const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WeekTimelineView({
  anchorIsoDay,
  items,
  tags,
  timeZone,
  onSelect,
}: Props) {
  const days = weekDays(anchorIsoDay, timeZone);
  const byDay = groupByLocalDay(items, timeZone);

  return (
    <div className="tl-week tl-week-agenda" data-testid="tl-week">
      {days.map((dayKey, idx) => (
        <AgendaDaySection
          key={dayKey}
          dayKey={dayKey}
          weekdayLabel={WEEKDAYS_SHORT[idx]}
          occs={byDay.get(dayKey) ?? []}
          tags={tags}
          timeZone={timeZone}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
