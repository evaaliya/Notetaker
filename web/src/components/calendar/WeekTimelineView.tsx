import type { RefObject } from "react";
import type { Note, Occurrence, Tag } from "../../api";
import { WEEKDAY_SHORT_RU } from "../../format";
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
  dndEnabled?: boolean;
  trashZoneRef?: RefObject<HTMLElement | null>;
  onDraggingChange?: (dragging: boolean, overTrash: boolean) => void;
  onDropRelocate?: (note: Note, starts_at: string, originalStart: string | null) => void;
  onTrashDrop?: (occ: Occurrence) => void;
  onDropError?: (msg: string) => void;
};

export function WeekTimelineView({
  anchorIsoDay,
  items,
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
  const days = weekDays(anchorIsoDay, timeZone);
  const byDay = groupByLocalDay(items, timeZone);

  return (
    <div className="tl-week tl-week-agenda" data-testid="tl-week">
      {days.map((dayKey, idx) => (
        <AgendaDaySection
          key={dayKey}
          dayKey={dayKey}
          weekdayLabel={WEEKDAY_SHORT_RU[idx]}
          occs={byDay.get(dayKey) ?? []}
          tags={tags}
          timeZone={timeZone}
          variant="week"
          onSelect={onSelect}
          dndEnabled={dndEnabled}
          trashZoneRef={trashZoneRef}
          onDraggingChange={onDraggingChange}
          onDropRelocate={onDropRelocate}
          onTrashDrop={onTrashDrop}
          onDropError={onDropError}
        />
      ))}
    </div>
  );
}
