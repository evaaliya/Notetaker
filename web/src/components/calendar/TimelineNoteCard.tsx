import type { CSSProperties } from "react";
import type { Occurrence, Tag } from "../../api";
import { formatTimeHm } from "../../format";
import { tagColors } from "../../lib/tagColors";
import { occKey } from "../../lib/calendar/groupByLocalDay";

type Props = {
  occ: Occurrence;
  tags: Tag[];
  timeZone: string;
  top: number;
  height: number;
  onSelect: (occ: Occurrence) => void;
};

function firstTag(occ: Occurrence, tags: Tag[]): Tag | undefined {
  const id = occ.note.tag_ids[0];
  return id ? tags.find((t) => t.id === id) : undefined;
}

export function TimelineNoteCard({ occ, tags, timeZone, top, height, onSelect }: Props) {
  const tag = firstTag(occ, tags);
  const colors = tagColors(tag?.color);
  const title = occ.note.title || "Без названия";
  const hm = formatTimeHm(occ.occurrence_start, timeZone);

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
          top,
          height,
          "--tag-bg": colors.fill,
          "--tag-fg": colors.ink,
        } as CSSProperties
      }
      onClick={() => onSelect(occ)}
    >
      <span className="tl-card-time">{hm}</span>
      <span className="tl-card-title">{title}</span>
    </button>
  );
}
