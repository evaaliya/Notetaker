import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import { DateTime } from "luxon";
import { Trash2 } from "lucide-react";
import { api, EditScope, Note, Occurrence, User } from "../api";
import { EditScopeDialog } from "../components/EditScopeDialog";
import { NoteSidePanel } from "../components/NoteSidePanel";
import { CalendarChrome } from "../components/calendar/CalendarChrome";
import { MonthCalendar } from "../components/calendar/MonthCalendar";
import { WeekTimelineView } from "../components/calendar/WeekTimelineView";
import { DayTimelineView } from "../components/calendar/DayTimelineView";
import { MOBILE_MAX, useMediaQuery } from "../hooks/useMediaQuery";
import {
  type CalView,
  rangeForView,
  shiftAnchor,
  todayAnchor,
} from "../lib/calendar/groupByLocalDay";
import { observeElementSize } from "../lib/observeElementSize";
import { recordRender } from "../lib/renderProbe";

type Selected = {
  note: Note;
  originalStart: string | null;
};

type PendingTrash = {
  note: Note;
  originalStart: string | null;
};

export function CalendarPage({ user }: { user: User }) {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  useLayoutEffect(() => {
    recordRender("calendar", performance.now() - t0);
  });
  const qc = useQueryClient();
  const isMobile = useMediaQuery(MOBILE_MAX);
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const tagList = tags.data ?? [];

  const [view, setView] = useState<CalView>(() => (isMobile ? "day" : "week"));
  const [anchor, setAnchor] = useState(() => todayAnchor(user.timezone));
  const [mainByDay, setMainByDay] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const [pendingTrash, setPendingTrash] = useState<PendingTrash | null>(null);
  const [undo, setUndo] = useState<{ noteId: string; title: string } | null>(null);
  const [monthTitle, setMonthTitle] = useState("");

  const trashZoneRef = useRef<HTMLDivElement>(null);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  const monthCalRef = useRef<FullCalendar>(null);
  const mobileInit = useRef(false);

  // Sync default view when crossing mobile breakpoint once.
  useEffect(() => {
    if (!mobileInit.current) {
      mobileInit.current = true;
      setView(isMobile ? "day" : "week");
      return;
    }
    if (isMobile && view === "week") {
      // keep user's choice; only initial default differs
    }
  }, [isMobile, view]);

  const computed = useMemo(
    () => rangeForView(view, anchor, user.timezone),
    [view, anchor, user.timezone],
  );

  const range = useMemo(
    () => ({ from: computed.from, to: computed.to }),
    [computed.from, computed.to],
  );

  const viewTitle = view === "month" && monthTitle ? monthTitle : computed.title;

  const cal = useQuery({
    queryKey: ["calendar", range.from, range.to],
    queryFn: () => api.calendar(range.from, range.to),
  });

  // Keep month FC on the anchor month.
  useEffect(() => {
    if (view !== "month") return;
    const apiFc = monthCalRef.current?.getApi();
    if (!apiFc) return;
    const target = DateTime.fromISO(anchor, { zone: user.timezone }).toJSDate();
    apiFc.gotoDate(target);
  }, [view, anchor, user.timezone]);

  useEffect(() => {
    const wrap = calendarWrapRef.current;
    if (!wrap || view !== "month") return;
    const update = () => monthCalRef.current?.getApi().updateSize();
    // rAF + ≥1px + ignore self (updateSize) — D-089/M23.
    const stopRo = observeElementSize(wrap, () => update());
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
      stopRo();
      frame?.removeEventListener("transitionend", onTransitionEnd);
      window.removeEventListener("resize", update);
    };
  }, [view]);

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

  const selectOcc = useCallback((occ: Occurrence) => {
    setSelected({
      note: occ.note,
      originalStart: occ.note.rec_freq ? occ.original_start : null,
    });
  }, []);

  const onMainChange = useCallback((dayKey: string, occ: Occurrence) => {
    setMainByDay((prev) => ({ ...prev, [dayKey]: `${occ.note.id}:${occ.original_start}` }));
  }, []);

  function goPrev() {
    setAnchor((a) => shiftAnchor(view, a, user.timezone, -1));
  }
  function goNext() {
    setAnchor((a) => shiftAnchor(view, a, user.timezone, 1));
  }
  function goToday() {
    setAnchor(todayAnchor(user.timezone));
  }
  function changeView(v: CalView) {
    setView(v);
  }

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

  function onTrashDrop(occ: Occurrence) {
    const originalStart = occ.note.rec_freq ? occ.original_start : null;
    if (originalStart) {
      setPendingTrash({ note: occ.note, originalStart });
      return;
    }
    void trashNote(occ.note).catch((err: Error) => setDropError(err.message));
  }

  const onMonthRangeChange = useCallback((_from: string, _to: string, title: string) => {
    setMonthTitle(title);
  }, []);

  return (
    <section className={`calendar-page${isMobile ? " calendar-page-mobile" : ""}`}>
      <div className="page-head">
        <div>
          <h1>Календарь</h1>
          {!isMobile && <div className="mut">{user.timezone}</div>}
        </div>
      </div>
      {dropError && (
        <p className="error" data-testid="cal-drop-error" role="alert">
          {dropError}
        </p>
      )}
      <div className={`calendar-layout${selected ? " with-panel" : ""}`}>
        <div
          className={`calendar-main card calendar-main-relative${isMobile ? " calendar-main-mobile" : ""}`}
          ref={calendarWrapRef}
          data-testid="calendar-main"
          data-cal-view={view}
        >
          <CalendarChrome
            title={viewTitle}
            view={view}
            isMobile={isMobile}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
            onViewChange={changeView}
          />
          {cal.isLoading && <p className="muted">Загрузка…</p>}
          {view === "month" && (
            <MonthCalendar
              timeZone={user.timezone}
              anchorIsoDay={anchor}
              items={cal.data?.items ?? []}
              tags={tagList}
              isMobile={isMobile}
              rangeFrom={range.from}
              rangeTo={range.to}
              mainByDay={mainByDay}
              onMainChange={onMainChange}
              onSelect={selectOcc}
              onRangeChange={onMonthRangeChange}
              onDropRelocate={(note, starts_at, originalStart) =>
                patchDrop.mutate({ note, starts_at, originalStart })
              }
              onDropError={setDropError}
              editable
              trashZoneRef={trashZoneRef}
              onDraggingChange={(d, over) => {
                setDragging(d);
                setOverTrash(over);
              }}
              onTrashDrop={onTrashDrop}
              calendarRef={monthCalRef}
            />
          )}
          {view === "week" && (
            <WeekTimelineView
              anchorIsoDay={anchor}
              items={cal.data?.items ?? []}
              tags={tagList}
              timeZone={user.timezone}
              stacked={isMobile}
              onSelect={selectOcc}
              dndEnabled
              trashZoneRef={trashZoneRef}
              onDraggingChange={(d, over) => {
                setDragging(d);
                setOverTrash(over);
              }}
              onDropRelocate={(note, starts_at, originalStart) =>
                patchDrop.mutate({ note, starts_at, originalStart })
              }
              onTrashDrop={onTrashDrop}
              onDropError={setDropError}
            />
          )}
          {view === "day" && (
            <DayTimelineView
              dayKey={anchor}
              items={cal.data?.items ?? []}
              tags={tagList}
              timeZone={user.timezone}
              onSelect={selectOcc}
              dndEnabled
              trashZoneRef={trashZoneRef}
              onDraggingChange={(d, over) => {
                setDragging(d);
                setOverTrash(over);
              }}
              onDropRelocate={(note, starts_at, originalStart) =>
                patchDrop.mutate({ note, starts_at, originalStart })
              }
              onTrashDrop={onTrashDrop}
              onDropError={setDropError}
            />
          )}
          <div
            ref={trashZoneRef}
            className={`cal-trash-zone${dragging ? " visible" : ""}${overTrash ? " active" : ""}`}
            data-testid="cal-trash-zone"
            data-cal-drop="trash"
            aria-hidden={!dragging}
          >
            <Trash2 aria-hidden="true" />
            <span>
              Отпустите, чтобы убрать в корзину{" "}
              <span className="cal-trash-hint">· вернуть можно в течение 30 дней</span>
            </span>
          </div>
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
