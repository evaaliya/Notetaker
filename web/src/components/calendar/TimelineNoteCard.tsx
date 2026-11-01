import type { CSSProperties } from "react";
import { DateTime } from "luxon";
import type { Occurrence, Tag } from "../../api";
import { formatTimeHm } from "../../format";
import { tagColors } from "../../lib/tagColors";
import { occKey } from "../../lib/calendar/groupByLocalDay";

/** Visual end when note has no ends_at: +30 minutes (display only). */
const DEFAULT_DURATION_MIN = 30;

type Props = {
  occ: Occurrence;
  tags: Tag[];
  timeZone: string;
  onSelect: (occ: Occurrence) => void;
};

function firstTag(occ: Occurrence, tags: Tag[]): Tag | undefined {
  const id = occ.note.tag_ids[0];
  return id ? tags.find((t) => t.id === id) : undefined;
}

export function eventTimeRangeLabel(startIso: string, timeZone: string): string {
  const start = DateTime.fromISO(startIso, { zone: "utc" }).setZone(timeZone);
  const end = start.plus({ minutes: DEFAULT_DURATION_MIN });
  const a = formatTimeHm(startIso, timeZone);
  const b = end.toFormat("HH:mm");
  return `${a}–${b}`;
}

export function TimelineNoteCard({ occ, tags, timeZone, onSelect }: Props) {
  const tag = firstTag(occ, tags);
  const colors = tagColors(tag?.color);
  const title = occ.note.title || "Без названия";
  const hm = formatTimeHm(occ.occurrence_start, timeZone);
  const range = eventTimeRangeLabel(occ.occurrence_start, timeZone);

  return (
    <button
      type="button"
      className="tl-card"
      data-testid="tl-card"
      data-occ-key={occKey(occ)}
      data-hm={hm}
      title={title}
      style={
        {
          "--tag-bg": colors.fill,
          "--tag-fg": colors.ink,
        } as CSSProperties
      }
      onClick={() => onSelect(occ)}
    >
      <span className="tl-card-range">{range}</span>
      <span className="tl-card-title">{title}</span>
    </button>
  );
}
