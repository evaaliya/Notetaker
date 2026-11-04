import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
} from "@fullcalendar/core";
import type { EventDragStartArg, EventDragStopArg } from "@fullcalendar/interaction";
import type { Note, Occurrence, Tag } from "../../api";
import { AttachmentClipIcon } from "../AttachmentsPanel";
import { NoteIllustration } from "../NoteIllustration";
import { TagPill } from "../TagPill";
import { tagColors } from "../../lib/tagColors";
import { formatTimeHm, relocateKeepWallTime } from "../../format";
import { DND_LONG_PRESS_MS } from "../../lib/calendar/dnd";
import {
  startDragAutoScroll,
  stopDragAutoScroll,
  updateDragAutoScroll,
} from "../../lib/calendar/dragAutoScroll";
import {
  groupByLocalDay,
  localDayKey,
  monthPillRange,
  occKey,
  pickMainOcc,
} from "../../lib/calendar/groupByLocalDay";
import { MonthDaySegments } from "./MonthDaySegments";

type Props = {
  timeZone: string;
  /** Local ISO date yyyy-MM-dd for initial/goto month. */
  anchorIsoDay: string;
  items: Occurrence[];
  tags: Tag[];
  isMobile: boolean;
  rangeFrom: string;
  rangeTo: string;
  /** Session overrides: dayKey → occKey */
  mainByDay: Record<string, string>;
  onMainChange: (dayKey: string, occ: Occurrence) => void;
  onSelect: (occ: Occurrence) => void;
  onRangeChange: (from: string, to: string, title: string) => void;
  onDropRelocate: (note: Note, starts_at: string, originalStart: string | null) => void;
  onDropError: (msg: string) => void;
  editable: boolean;
  trashZoneRef: RefObject<HTMLDivElement | null>;
  onDraggingChange: (dragging: boolean, overTrash: boolean) => void;
  onTrashDrop: (occ: Occurrence) => void;
  calendarRef: MutableRefObject<FullCalendar | null>;
};

function toIsoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function firstTag(note: Note, tags: Tag[]): Tag | undefined {
  const id = note.tag_ids[0];
  return id ? tags.find((t) => t.id === id) : undefined;
}

export function MonthCalendar({
  timeZone,
  anchorIsoDay,
  items,
  tags,
  isMobile,
  mainByDay,
  onMainChange,
  onSelect,
  onRangeChange,
  onDropRelocate,
  onDropError,
  editable,
  trashZoneRef,
  onDraggingChange,
  onTrashDrop,
  calendarRef,
}: Props) {
  const byDay = useMemo(() => groupByLocalDay(items, timeZone), [items, timeZone]);
  const [hosts, setHosts] = useState<Record<string, HTMLElement>>({});
  const dropOnTrashRef = useRef(false);
  const dragOccRef = useRef<Occurrence | null>(null);
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;
  const trashZoneRefLatest = trashZoneRef;

  const onMonthDragPointerMove = useCallback((e: PointerEvent) => {
    updateDragAutoScroll(e.clientX, e.clientY);
    const zone = trashZoneRefLatest.current;
    let over = false;
    if (zone) {
      const r = zone.getBoundingClientRect();
      over =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
    }
    onDraggingChangeRef.current(true, over);
  }, [trashZoneRefLatest]);

  const detachMonthDragScroll = useCallback(() => {
    window.removeEventListener("pointermove", onMonthDragPointerMove);
    stopDragAutoScroll();
  }, [onMonthDragPointerMove]);

  useEffect(() => () => detachMonthDragScroll(), [detachMonthDragScroll]);

  const mainEvents = useMemo(() => {
    const out: {
      id: string;
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      backgroundColor: string;
      borderColor: string;
      textColor: string;
      extendedProps: { occurrence: Occurrence };
    }[] = [];
    for (const [dayKey, occs] of byDay) {
      const main = pickMainOcc(occs, mainByDay[dayKey]);
      if (!main) continue;
      const tag = firstTag(main.note, tags);
      const colors = tagColors(tag?.color);
      // Clamp end to local day so late starts (e.g. 23:29) do not spill into tomorrow (D-104).
      const { start, end } = monthPillRange(main.occurrence_start, timeZone);
      out.push({
        id: occKey(main),
        title: main.note.title || "Без названия",
        start,
        end,
        allDay: false,
        backgroundColor: colors.fill,
        borderColor: colors.ink,
        textColor: "#2B2620",
        extendedProps: { occurrence: main },
      });
    }
    return out;
  }, [byDay, mainByDay, tags, timeZone]);

  const refreshHosts = useCallback(() => {
    const next: Record<string, HTMLElement> = {};
    document.querySelectorAll<HTMLElement>(".fc-daygrid-day[data-date]").forEach((cell) => {
      const date = cell.getAttribute("data-date");
      if (!date) return;
      const frame = cell.querySelector<HTMLElement>(".fc-daygrid-day-frame");
      if (!frame) return;
      let host = frame.querySelector<HTMLElement>(".month-seg-host");
      if (!host) {
        host = document.createElement("div");
        host.className = "month-seg-host";
        frame.appendChild(host);
      }
      next[date] = host;
    });
    setHosts(next);
  }, []);

  const onDatesSet = useCallback(
    (arg: DatesSetArg) => {
      onRangeChange(toIsoZ(arg.start), toIsoZ(arg.end), arg.view.title);
      // Defer host scan until FC painted day cells.
      requestAnimationFrame(() => refreshHosts());
    },
    [onRangeChange, refreshHosts],
  );

  useEffect(() => {
    refreshHosts();
  }, [mainEvents, refreshHosts]);

  function hitTrashZone(jsEvent: MouseEvent | undefined | null): boolean {
    const zone = trashZoneRef.current;
    if (!zone || !jsEvent) return false;
    const r = zone.getBoundingClientRect();
    return (
      jsEvent.clientX >= r.left &&
      jsEvent.clientX <= r.right &&
      jsEvent.clientY >= r.top &&
      jsEvent.clientY <= r.bottom
    );
  }

  function onEventClick(arg: EventClickArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence;
    onSelect(occ);
  }

  function onEventDragStart(arg: EventDragStartArg) {
    dropOnTrashRef.current = false;
    dragOccRef.current = (arg.event.extendedProps.occurrence as Occurrence) ?? null;
    onDraggingChange(true, false);
    const js = arg.jsEvent as MouseEvent | undefined;
    const x = js?.clientX ?? 0;
    const y = js?.clientY ?? 0;
    startDragAutoScroll(x, y);
    window.addEventListener("pointermove", onMonthDragPointerMove);
  }

  function onEventDragStop(arg: EventDragStopArg) {
    detachMonthDragScroll();
    const js = arg.jsEvent as MouseEvent | undefined;
    const hit = hitTrashZone(js);
    dropOnTrashRef.current = hit;
    if (hit && dragOccRef.current) {
      const occ = dragOccRef.current;
      dragOccRef.current = null;
      onDraggingChange(false, false);
      onTrashDrop(occ);
      return;
    }
    dragOccRef.current = null;
    onDraggingChange(false, false);
  }

  function onEventDrop(arg: EventDropArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence;
    const toTrash = dropOnTrashRef.current || hitTrashZone(arg.jsEvent as MouseEvent);
    dropOnTrashRef.current = false;
    if (toTrash) {
      arg.revert();
      onTrashDrop(occ);
      return;
    }
    const drop = arg.event.start;
    if (!drop) {
      arg.revert();
      return;
    }
    try {
      const starts_at = relocateKeepWallTime(occ.occurrence_start, drop, timeZone);
      onDropRelocate(
        occ.note,
        starts_at,
        occ.note.rec_freq ? occ.original_start : null,
      );
    } catch (e) {
      arg.revert();
      onDropError(e instanceof Error ? e.message : String(e));
    }
  }

  function renderEventContent(arg: EventContentArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence | undefined;
    if (!occ) return true;
    const tag = firstTag(occ.note, tags);
    const allTags = occ.note.tag_ids
      .map((id) => tags.find((t) => t.id === id))
      .filter(Boolean) as Tag[];
    const pills = allTags.slice(0, 2);
    const more = Math.max(0, allTags.length - pills.length);
    const hm = formatTimeHm(occ.occurrence_start, timeZone);
    const colors = tagColors(tag?.color);

    if (isMobile) {
      return (
        <div
          className="cal-event cal-event-compact"
          data-occ-key={occKey(occ)}
          data-testid="month-main-pill"
          style={
            {
              "--tag-bg": colors.fill,
              "--tag-fg": colors.ink,
            } as CSSProperties
          }
        >
          <div className="cal-event-body">
            <span className="cal-event-time">{hm}</span>
            <b>
              {arg.event.title}
              {occ.note.has_attachments ? <AttachmentClipIcon /> : null}
            </b>
            {pills[0] ? <TagPill name={pills[0].name} color={pills[0].color} /> : null}
          </div>
        </div>
      );
    }

    return (
      <div
        className="cal-event"
        data-occ-key={occKey(occ)}
        data-testid="month-main-pill"
        style={
          {
            "--tag-bg": colors.fill,
            "--tag-fg": colors.ink,
          } as CSSProperties
        }
      >
        <NoteIllustration
          title={occ.note.title}
          body={occ.note.body}
          tagName={tag?.name}
          tagColor={tag?.color}
          size={34}
        />
        <div className="cal-event-body">
          <b>
            {arg.event.title}
            {occ.note.has_attachments ? <AttachmentClipIcon /> : null}
          </b>
          {occ.note.role === "editor" && occ.note.owner_login ? (
            <span className="cal-event-shared" data-testid="shared-note-badge">
              Общая · владелец: {occ.note.owner_login}
            </span>
          ) : null}
          <span className="cal-event-time">{hm}</span>
          {pills.length > 0 && (
            <div className="cal-event-tags">
              {pills.map((t) => (
                <TagPill key={t.id} name={t.name} color={t.color} />
              ))}
              {more > 0 && <span className="cal-more">+{more}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Portals for sausage under each day that has 2+ notes.
  const portals = Object.entries(hosts).map(([dayKey, host]) => {
    const occs = byDay.get(dayKey) ?? [];
    if (occs.length === 0) return null;
    const main = pickMainOcc(occs, mainByDay[dayKey]);
    return createPortal(
      <MonthDaySegments
        key={dayKey}
        dayKey={dayKey}
        occs={occs}
        tags={tags}
        mainKey={main ? occKey(main) : null}
        timeZone={timeZone}
        onSelect={(occ) => {
          onMainChange(dayKey, occ);
          onSelect(occ);
        }}
      />,
      host,
    );
  });

  // Ensure dayKey for events uses local date — FC may use UTC date attribute.
  void localDayKey;

  return (
    <>
      <FullCalendar
        ref={calendarRef as RefObject<FullCalendar>}
        plugins={[dayGridPlugin, interactionPlugin, luxonPlugin]}
        initialView="dayGridMonth"
        initialDate={anchorIsoDay}
        headerToolbar={false}
        locale="ru"
        timeZone={timeZone}
        height="auto"
        editable={editable}
        eventStartEditable={editable}
        eventDurationEditable={false}
        longPressDelay={DND_LONG_PRESS_MS}
        eventLongPressDelay={DND_LONG_PRESS_MS}
        dayMaxEvents={1}
        moreLinkText="ещё"
        // Midnights: timed pills must not continue into the next day cell (D-104).
        nextDayThreshold="00:00:00"
        displayEventEnd={false}
        eventTimeFormat={{
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          omitZeroMinute: false,
        }}
        eventContent={renderEventContent}
        events={mainEvents}
        datesSet={onDatesSet}
        eventClick={onEventClick}
        eventDrop={editable ? onEventDrop : undefined}
        eventDragStart={editable ? onEventDragStart : undefined}
        eventDragStop={editable ? onEventDragStop : undefined}
      />
      {portals}
    </>
  );
}
