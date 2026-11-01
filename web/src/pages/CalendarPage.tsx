import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import luxonPlugin from "@fullcalendar/luxon3";
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
} from "@fullcalendar/core";
import type { EventDragStartArg, EventDragStopArg } from "@fullcalendar/interaction";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { api, EditScope, Note, Occurrence, Tag, User } from "../api";
import { EditScopeDialog } from "../components/EditScopeDialog";
import { AttachmentClipIcon } from "../components/AttachmentsPanel";
import { NoteIllustration } from "../components/NoteIllustration";
import { NoteSidePanel } from "../components/NoteSidePanel";
import { TagPill } from "../components/TagPill";
import { MOBILE_MAX, useMediaQuery } from "../hooks/useMediaQuery";
import { tagColors } from "../lib/tagColors";
import { formatTimeHm, relocateKeepWallTime } from "../format";
import { recordRender } from "../lib/renderProbe";

/** Timed event end for FC: default 30m, never past local midnight (D-088). */
function eventEndIso(startIso: string, timeZone: string, durationMin = 30): string {
  const start = DateTime.fromISO(startIso, { zone: "utc" }).setZone(timeZone);
  const dayEnd = start.endOf("day");
  const natural = start.plus({ minutes: durationMin });
  const end = natural <= dayEnd ? natural : dayEnd;
  // FC exclusive end: if clamped to day end, use start of next day so the block fills the last slot.
  const exclusive =
    end.equals(dayEnd) || end > dayEnd ? start.plus({ days: 1 }).startOf("day") : end;
  return exclusive.toUTC().toISO({ suppressMilliseconds: true })!.replace(/\+00:00$/, "Z");
}

type CalView = "timeGridDay" | "timeGridWeek" | "dayGridMonth";

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
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  useLayoutEffect(() => {
    recordRender("calendar", performance.now() - t0);
  });
  const qc = useQueryClient();
  const isMobile = useMediaQuery(MOBILE_MAX);
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const tagList = tags.data ?? [];
  const [range, setRange] = useState<Range | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const [pendingTrash, setPendingTrash] = useState<PendingTrash | null>(null);
  const [undo, setUndo] = useState<{ noteId: string; title: string } | null>(null);
  const [viewTitle, setViewTitle] = useState("");
  const [mobileView, setMobileView] = useState<CalView>("timeGridDay");
  const trashZoneRef = useRef<HTMLDivElement>(null);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<FullCalendar>(null);
  const dropOnTrashRef = useRef(false);
  const overTrashRef = useRef(false);
  const dragOccRef = useRef<Occurrence | null>(null);

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
          end: eventEndIso(it.occurrence_start, user.timezone),
          allDay: false,
          backgroundColor: colors.fill,
          borderColor: colors.ink,
          textColor: "#2B2620",
          extendedProps: { occurrence: it },
        };
      }),
    [cal.data, tagList, user.timezone],
  );

  // Recalculate FC geometry when the calendar container or sidebar width changes (D-089).
  useEffect(() => {
    const wrap = calendarWrapRef.current;
    if (!wrap) return;
    const update = () => {
      calendarRef.current?.getApi().updateSize();
    };
    const ro = new ResizeObserver(() => update());
    ro.observe(wrap);
    const frame = wrap.closest(".app-frame");
    const onTransitionEnd = (e: Event) => {
      const te = e as TransitionEvent;
      if (
        te.propertyName === "grid-template-columns" ||
        te.propertyName.includes("grid") ||
        te.target === frame
      ) {
        update();
      }
    };
    frame?.addEventListener("transitionend", onTransitionEnd);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      frame?.removeEventListener("transitionend", onTransitionEnd);
      window.removeEventListener("resize", update);
    };
  }, []);

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
    setViewTitle(arg.view.title);
  }, []);

  function calApi() {
    return calendarRef.current?.getApi() ?? null;
  }

  function goPrev() {
    calApi()?.prev();
  }
  function goNext() {
    calApi()?.next();
  }
  function goToday() {
    calApi()?.today();
  }
  function changeMobileView(view: CalView) {
    setMobileView(view);
    calApi()?.changeView(view);
  }

  useEffect(() => {
    const apiFc = calApi();
    if (!apiFc) return;
    if (isMobile) {
      apiFc.changeView(mobileView);
    } else if (apiFc.view.type === "timeGridDay") {
      apiFc.changeView("timeGridWeek");
    }
    // remount key also handles hard switch; this covers live resize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

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

  function onEventDragStart(arg: EventDragStartArg) {
    dropOnTrashRef.current = false;
    dragOccRef.current = (arg.event.extendedProps.occurrence as Occurrence) ?? null;
    setDragging(true);
    setOverTrash(false);
  }

  function onEventDragStop(arg: EventDragStopArg) {
    const js = arg.jsEvent as MouseEvent | undefined;
    const hit = hitTrashZone(js);
    dropOnTrashRef.current = hit;
    if (hit && dragOccRef.current) {
      const occ = dragOccRef.current;
      dragOccRef.current = null;
      setDragging(false);
      setOverTrash(false);
      const originalStart = occ.note.rec_freq ? occ.original_start : null;
      if (originalStart) {
        setPendingTrash({ note: occ.note, originalStart });
      } else {
        void trashNote(occ.note).catch((err: Error) => setDropError(err.message));
      }
      return;
    }
    dragOccRef.current = null;
    setDragging(false);
    setOverTrash(false);
  }

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

  function onEventDrop(arg: EventDropArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence;
    // FC may fire eventDrop before eventDragStop — check zone from jsEvent too.
    const toTrash = dropOnTrashRef.current || hitTrashZone(arg.jsEvent as MouseEvent);
    dropOnTrashRef.current = false;
    if (toTrash) {
      arg.revert();
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

    if (isMobile) {
      return (
        <div
          className="cal-event cal-event-compact"
          data-occ-key={`${occ.note.id}:${occ.original_start}`}
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
        data-occ-key={`${occ.note.id}:${occ.original_start}`}
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

  useEffect(() => {
    const wrap = calendarWrapRef.current;
    if (!wrap || isMobile) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".fc-event")) return;
      dropOnTrashRef.current = false;
      overTrashRef.current = false;
      setDragging(true);
      setOverTrash(false);
      const keyEl = t.closest("[data-occ-key]") as HTMLElement | null;
      const key = keyEl?.getAttribute("data-occ-key");
      if (key && cal.data) {
        const found = cal.data.items.find(
          (it) => `${it.note.id}:${it.original_start}` === key,
        );
        if (found) dragOccRef.current = found;
      }
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragOccRef.current) return;
      const hit = hitTrashZone(e);
      overTrashRef.current = hit;
      dropOnTrashRef.current = hit;
      setOverTrash(hit);
    }
    function onPointerUp() {
      const occ = dragOccRef.current;
      const hit = overTrashRef.current || dropOnTrashRef.current;
      setDragging(false);
      setOverTrash(false);
      overTrashRef.current = false;
      if (hit && occ) {
        dragOccRef.current = null;
        dropOnTrashRef.current = false;
        const originalStart = occ.note.rec_freq ? occ.original_start : null;
        if (originalStart) {
          setPendingTrash({ note: occ.note, originalStart });
        } else {
          void trashNote(occ.note).catch((err: Error) => setDropError(err.message));
        }
        return;
      }
      dragOccRef.current = null;
      dropOnTrashRef.current = false;
    }
    wrap.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      wrap.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [cal.data, isMobile]);

  return (
    <section className={`calendar-page${isMobile ? " calendar-page-mobile" : ""}`}>
      <div className="page-head">
        <div>
          <h1>Календарь</h1>
          {!isMobile && <div className="mut">{user.timezone}</div>}
        </div>
      </div>
      {dropError && <p className="error">{dropError}</p>}
      <div className={`calendar-layout${selected ? " with-panel" : ""}`}>
        <div
          className={`calendar-main card calendar-main-relative${isMobile ? " calendar-main-mobile" : ""}`}
          ref={calendarWrapRef}
          data-testid="calendar-main"
        >
          {isMobile && (
            <div className="cal-mobile-chrome" data-testid="cal-mobile-chrome">
              <div className="cal-mobile-nav">
                <button
                  type="button"
                  className="secondary cal-mobile-nav-btn"
                  aria-label="Предыдущий период"
                  data-testid="cal-mobile-prev"
                  onClick={goPrev}
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </button>
                <div className="cal-mobile-title" data-testid="cal-mobile-title">
                  {viewTitle || "…"}
                </div>
                <button
                  type="button"
                  className="secondary cal-mobile-nav-btn"
                  aria-label="Следующий период"
                  data-testid="cal-mobile-next"
                  onClick={goNext}
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="secondary cal-mobile-today"
                  data-testid="cal-mobile-today"
                  onClick={goToday}
                >
                  Сегодня
                </button>
              </div>
              <div
                className="cal-mobile-views"
                role="tablist"
                aria-label="Режим календаря"
                data-testid="cal-mobile-views"
              >
                {(
                  [
                    ["timeGridDay", "День"],
                    ["timeGridWeek", "Неделя"],
                    ["dayGridMonth", "Месяц"],
                  ] as const
                ).map(([view, label]) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    aria-selected={mobileView === view}
                    className={mobileView === view ? "on" : undefined}
                    data-testid={`cal-mobile-view-${view}`}
                    onClick={() => changeMobileView(view)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {cal.isLoading && <p className="muted">Загрузка…</p>}
          <FullCalendar
            key={isMobile ? "mobile" : "desktop"}
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
            initialView={isMobile ? mobileView : "timeGridWeek"}
            headerToolbar={
              isMobile
                ? false
                : {
                    left: "prev,next today",
                    center: "title",
                    right: "dayGridMonth,timeGridWeek,timeGridDay",
                  }
            }
            buttonText={{
              today: "Сегодня",
              month: "Месяц",
              week: "Неделя",
              day: "День",
            }}
            locale="ru"
            timeZone={user.timezone}
            height={isMobile ? "100%" : "auto"}
            editable={!isMobile}
            eventStartEditable={!isMobile}
            eventDurationEditable={false}
            /* D-041: default slotEventOverlap:true squeezed many timed events
               into unreadably thin columns (~3 visible). Stack instead. */
            slotEventOverlap={false}
            eventMinHeight={isMobile ? 44 : 52}
            dayMaxEvents={isMobile ? 3 : false}
            moreLinkText="ещё"
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
            eventDrop={isMobile ? undefined : onEventDrop}
            eventDragStart={isMobile ? undefined : onEventDragStart}
            eventDragStop={isMobile ? undefined : onEventDragStop}
          />
          {!isMobile && (
            <div
              ref={trashZoneRef}
              className={`cal-trash-zone${dragging ? " visible" : ""}${overTrash ? " active" : ""}`}
              data-testid="cal-trash-zone"
              aria-hidden={!dragging}
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
            key={`${selected.note.id}:${selected.originalStart ?? "single"}`}
            user={user}
            tags={tagList}
            note={selected.note}
            occurrenceOriginalStart={selected.originalStart}
            presentation={isMobile ? "sheet" : "aside"}
            onClose={() => setSelected(null)}
            onTrash={
              selected.note.role === "editor"
                ? undefined
                : () => {
                    const s = selected;
                    if (s.originalStart) {
                      setPendingTrash({
                        note: s.note,
                        originalStart: s.originalStart,
                      });
                      return;
                    }
                    void trashNote(s.note).catch((err: Error) => setDropError(err.message));
                  }
            }
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
