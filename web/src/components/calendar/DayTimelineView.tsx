import type { RefObject } from "react";
import { DateTime } from "luxon";
import type { Note, Occurrence, Tag } from "../../api";
import { WEEKDAY_SHORT_RU } from "../../format";
import { groupByLocalDay } from "../../lib/calendar/groupByLocalDay";
import { AgendaDaySection } from "./AgendaDaySection";

type Props = {
  dayKey: string;
  items: Occurrence[];
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

export function DayTimelineView({
  dayKey,
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
  const byDay = groupByLocalDay(items, timeZone);
  const occs = byDay.get(dayKey) ?? [];
  const dt = DateTime.fromISO(dayKey, { zone: timeZone });
  const wd = WEEKDAY_SHORT_RU[dt.weekday - 1];

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
        dndEnabled={dndEnabled}
        trashZoneRef={trashZoneRef}
        onDraggingChange={onDraggingChange}
        onDropRelocate={onDropRelocate}
        onTrashDrop={onTrashDrop}
        onDropError={onDropError}
      />
    </div>
  );
}
