import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
} from "@fullcalendar/core";
import type { EventDragStartArg, EventDragStopArg } from "@fullcalendar/interaction";
import { Trash2 } from "lucide-react";
import { api, EditScope, Note, Occurrence, Tag, User } from "../api";
import { EditScopeDialog } from "../components/EditScopeDialog";
import { NoteIllustration } from "../components/NoteIllustration";
import { NoteSidePanel } from "../components/NoteSidePanel";
import { TagPill } from "../components/TagPill";
import { tagColors } from "../lib/tagColors";
import { formatTimeHm, relocateKeepWallTime } from "../format";

type Range = { from: string; to: string };

type Selected = {
  note: Note;
  originalStart: string | null;
};

type PendingTrash = {
  note: Note;
  originalStart: string | null;
};

function toIsoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function firstTag(note: Note, tags: Tag[]): Tag | undefined {
  const id = note.tag_ids[0];
  return id ? tags.find((t) => t.id === id) : undefined;
}

export function CalendarPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const tagList = tags.data ?? [];
  const [range, setRange] = useState<Range | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const [pendingTrash, setPendingTrash] = useState<PendingTrash | null>(null);
  const [undo, setUndo] = useState<{ noteId: string; title: string } | null>(null);
  const trashZoneRef = useRef<HTMLDivElement>(null);
  const dropOnTrashRef = useRef(false);

  const cal = useQuery({
    queryKey: ["calendar", range?.from, range?.to],
    queryFn: () => api.calendar(range!.from, range!.to),
    enabled: !!range,
  });

  const events = useMemo(
    () =>
      (cal.data?.items ?? []).map((it) => {
        const tag = firstTag(it.note, tagList);
        const colors = tagColors(tag?.color);
        return {
          id: `${it.note.id}:${it.original_start}`,
          title: it.note.title || "Без названия",
          start: it.occurrence_start,
          allDay: false,
          backgroundColor: colors.fill,
          borderColor: colors.ink,
          textColor: "#2B2620",
          extendedProps: { occurrence: it },
        };
      }),
    [cal.data, tagList],
  );

  useEffect(() => {
    if (!selected || !cal.data) return;
    const found = cal.data.items.find(
      (it) =>
        it.note.id === selected.note.id &&
        (selected.originalStart == null || it.original_start === selected.originalStart),
    );
    if (found && found.note.version !== selected.note.version) {
      setSelected({
        note: found.note,
        originalStart: found.note.rec_freq ? found.original_start : null,
      });
    }
  }, [cal.data, selected]);

  const onDatesSet = useCallback((arg: DatesSetArg) => {
    setRange({ from: toIsoZ(arg.start), to: toIsoZ(arg.end) });
  }, []);

  const patchDrop = useMutation({
    mutationFn: ({
      note,
      starts_at,
      originalStart,
    }: {
      note: Note;
      starts_at: string;
      originalStart: string | null;
    }) => {
      if (note.rec_freq && originalStart) {
        return api.patchNote(
          note.id,
          { version: note.version, starts_at },
          { scope: "this", occurrence_start: originalStart },
        );
      }
      return api.patchNote(note.id, { version: note.version, starts_at });
    },
    onSuccess: (updated, vars) => {
      setDropError(null);
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      setSelected((prev) =>
        prev && prev.note.id === updated.id
          ? { note: updated, originalStart: vars.originalStart }
          : prev,
      );
    },
    onError: (err: Error) => {
      setDropError(err.message);
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  async function trashNote(note: Note, scope?: EditScope, occurrenceStart?: string | null) {
    await api.deleteNote(
      note.id,
      scope && occurrenceStart
        ? { scope, occurrence_start: occurrenceStart }
        : undefined,
    );
    qc.invalidateQueries({ queryKey: ["calendar"] });
    qc.invalidateQueries({ queryKey: ["upcoming"] });
    qc.invalidateQueries({ queryKey: ["notes"] });
    qc.invalidateQueries({ queryKey: ["trash"] });
    setSelected(null);
    if (!scope || scope === "all") {
      setUndo({ noteId: note.id, title: note.title || "Без названия" });
    }
  }

  async function undoTrash() {
    if (!undo) return;
    await api.restoreNote(undo.noteId);
    setUndo(null);
    qc.invalidateQueries({ queryKey: ["calendar"] });
    qc.invalidateQueries({ queryKey: ["upcoming"] });
    qc.invalidateQueries({ queryKey: ["notes"] });
    qc.invalidateQueries({ queryKey: ["trash"] });
  }

  function onEventClick(arg: EventClickArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence;
    setSelected({
      note: occ.note,
      originalStart: occ.note.rec_freq ? occ.original_start : null,
    });
  }

  function onEventDragStart(_arg: EventDragStartArg) {
    dropOnTrashRef.current = false;
    setDragging(true);
    setOverTrash(false);
  }

  function onEventDragStop(arg: EventDragStopArg) {
    const zone = trashZoneRef.current;
    const js = arg.jsEvent as MouseEvent | undefined;
    let hit = false;
    if (zone && js) {
      const r = zone.getBoundingClientRect();
      hit =
        js.clientX >= r.left &&
        js.clientX <= r.right &&
        js.clientY >= r.top &&
        js.clientY <= r.bottom;
    }
    dropOnTrashRef.current = hit;
    setDragging(false);
    setOverTrash(false);
  }

  function onEventDrop(arg: EventDropArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence;
    if (dropOnTrashRef.current) {
      arg.revert();
      dropOnTrashRef.current = false;
      const originalStart = occ.note.rec_freq ? occ.original_start : null;
      if (originalStart) {
        setPendingTrash({ note: occ.note, originalStart });
        return;
      }
      void trashNote(occ.note).catch((err: Error) => setDropError(err.message));
      return;
    }
    const drop = arg.event.start;
    if (!drop) {
      arg.revert();
      return;
    }
    const baseIso = occ.occurrence_start;
    const starts_at = relocateKeepWallTime(baseIso, drop, user.timezone);
    patchDrop.mutate(
      {
        note: occ.note,
        starts_at,
        originalStart: occ.note.rec_freq ? occ.original_start : null,
      },
      { onError: () => arg.revert() },
    );
  }

  function renderEventContent(arg: EventContentArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence | undefined;
    if (!occ) return true;
    const tag = firstTag(occ.note, tagList);
    const allTags = occ.note.tag_ids
      .map((id) => tagList.find((t) => t.id === id))
      .filter(Boolean) as Tag[];
    const pills = allTags.slice(0, 2);
    const more = Math.max(0, allTags.length - pills.length);
    const hm = formatTimeHm(occ.occurrence_start, user.timezone);
    const colors = tagColors(tag?.color);

    return (
      <div
        className="cal-event"
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
          <b>{arg.event.title}</b>
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

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const zone = trashZoneRef.current;
      if (!zone) return;
      const r = zone.getBoundingClientRect();
      const hit =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      setOverTrash(hit);
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [dragging]);

  return (
    <section className="calendar-page">
      <div className="page-head">
        <div>
          <h1>Календарь</h1>
          <div className="mut">{user.timezone}</div>
        </div>
      </div>
      {dropError && <p className="error">{dropError}</p>}
      <div className={`calendar-layout${selected ? " with-panel" : ""}`}>
        <div className="calendar-main card calendar-main-relative">
          {cal.isLoading && <p className="muted">Загрузка…</p>}
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay",
            }}
            buttonText={{
              today: "Сегодня",
              month: "Месяц",
              week: "Неделя",
              day: "День",
            }}
            locale="ru"
            timeZone={user.timezone}
            height="auto"
            editable
            eventStartEditable
            eventDurationEditable={false}
            /* D-041: default slotEventOverlap:true squeezed many timed events
               into unreadably thin columns (~3 visible). Stack instead. */
            slotEventOverlap={false}
            eventMinHeight={52}
            dayMaxEvents={false}
            eventTimeFormat={{
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              omitZeroMinute: false,
            }}
            slotLabelFormat={{
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              omitZeroMinute: false,
            }}
            eventContent={renderEventContent}
            events={events}
            datesSet={onDatesSet}
            eventClick={onEventClick}
            eventDrop={onEventDrop}
            eventDragStart={onEventDragStart}
            eventDragStop={onEventDragStop}
          />
          {dragging && (
            <div
              ref={trashZoneRef}
              className={`cal-trash-zone${overTrash ? " active" : ""}`}
              data-testid="cal-trash-zone"
            >
              <Trash2 aria-hidden="true" />
              <span>
                Отпустите, чтобы убрать в корзину{" "}
                <span className="cal-trash-hint">· вернуть можно в течение 30 дней</span>
              </span>
            </div>
          )}
        </div>
        {selected && (
          <NoteSidePanel
            user={user}
            tags={tagList}
            note={selected.note}
            occurrenceOriginalStart={selected.originalStart}
            onClose={() => setSelected(null)}
            onSaved={(n) => {
              setSelected((prev) =>
                prev ? { note: n, originalStart: prev.originalStart } : null,
              );
              qc.invalidateQueries({ queryKey: ["calendar"] });
              qc.invalidateQueries({ queryKey: ["upcoming"] });
              qc.invalidateQueries({ queryKey: ["notes"] });
            }}
          />
        )}
      </div>

      {pendingTrash && (
        <EditScopeDialog
          allowAll
          onChoose={(scope) => {
            const p = pendingTrash;
            setPendingTrash(null);
            void trashNote(p.note, scope, p.originalStart).catch((err: Error) =>
              setDropError(err.message),
            );
          }}
          onClose={() => setPendingTrash(null)}
        />
      )}

      {undo && (
        <div className="toast-stack" data-testid="trash-undo-toast" aria-live="polite">
          <div className="toast">
            <div>
              <strong>В корзине</strong>
              <p className="small muted">{undo.title}</p>
            </div>
            <button
              type="button"
              className="secondary"
              data-testid="trash-undo"
              onClick={() => void undoTrash()}
            >
              Отменить
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
