import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import { api, Note, Occurrence, User } from "../api";
import { NoteSidePanel } from "../components/NoteSidePanel";
import { formatTimeHm, relocateKeepWallTime } from "../format";

type Range = { from: string; to: string };

type Selected = {
  note: Note;
  originalStart: string | null;
};

function toIsoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function CalendarPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const [range, setRange] = useState<Range | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const cal = useQuery({
    queryKey: ["calendar", range?.from, range?.to],
    queryFn: () => api.calendar(range!.from, range!.to),
    enabled: !!range,
  });

  const events = useMemo(
    () =>
      (cal.data?.items ?? []).map((it) => ({
        id: `${it.note.id}:${it.original_start}`,
        title: it.note.title || "Без названия",
        start: it.occurrence_start,
        allDay: false,
        extendedProps: { occurrence: it },
      })),
    [cal.data],
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

  function onEventClick(arg: EventClickArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence;
    setSelected({
      note: occ.note,
      originalStart: occ.note.rec_freq ? occ.original_start : null,
    });
  }

  function onEventDrop(arg: EventDropArg) {
    const occ = arg.event.extendedProps.occurrence as Occurrence;
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

  return (
    <section className="calendar-page">
      <div className="list-toolbar">
        <h2>Календарь</h2>
        <span className="muted small">{user.timezone}</span>
      </div>
      {dropError && <p className="error">{dropError}</p>}
      <div className={`calendar-layout${selected ? " with-panel" : ""}`}>
        <div className="calendar-main card">
          {cal.isLoading && <p className="muted">Загрузка…</p>}
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
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
            // Always HH:MM — FC default omitZeroMinute turns :00 into bare hour ("04").
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
            eventContent={(arg) => {
              const occ = arg.event.extendedProps.occurrence as Occurrence | undefined;
              const iso =
                occ?.occurrence_start ??
                (arg.event.start ? arg.event.start.toISOString() : "");
              const hm = iso ? formatTimeHm(iso, user.timezone) : arg.timeText;
              return (
                <>
                  <div className="fc-event-time">{hm}</div>
                  <div className="fc-event-title">{arg.event.title}</div>
                </>
              );
            }}
            events={events}
            datesSet={onDatesSet}
            eventClick={onEventClick}
            eventDrop={onEventDrop}
          />
        </div>
        {selected && (
          <NoteSidePanel
            user={user}
            tags={tags.data ?? []}
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
    </section>
  );
}
