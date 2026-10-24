import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventDropArg } from "@fullcalendar/core";
import { api, Note, User } from "../api";
import { NoteSidePanel } from "../components/NoteSidePanel";
import { relocateKeepWallTime } from "../format";

type Range = { from: string; to: string };

function toIsoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function CalendarPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const [range, setRange] = useState<Range | null>(null);
  const [selected, setSelected] = useState<Note | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const cal = useQuery({
    queryKey: ["calendar", range?.from, range?.to],
    queryFn: () => api.calendar(range!.from, range!.to),
    enabled: !!range,
  });

  const events = useMemo(
    () =>
      (cal.data?.items ?? []).map((it) => ({
        id: it.note.id,
        title: it.note.title || "Без названия",
        start: it.occurrence_start,
        allDay: false,
        extendedProps: { note: it.note },
      })),
    [cal.data],
  );

  useEffect(() => {
    if (!selected || !cal.data) return;
    const found = cal.data.items.find((it) => it.note.id === selected.id);
    if (found && found.note.version !== selected.version) {
      setSelected(found.note);
    }
  }, [cal.data, selected]);

  const onDatesSet = useCallback((arg: DatesSetArg) => {
    setRange({ from: toIsoZ(arg.start), to: toIsoZ(arg.end) });
  }, []);

  const patchDrop = useMutation({
    mutationFn: ({ note, starts_at }: { note: Note; starts_at: string }) =>
      api.patchNote(note.id, { version: note.version, starts_at }),
    onSuccess: (updated) => {
      setDropError(null);
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      setSelected((prev) => (prev && prev.id === updated.id ? updated : prev));
    },
    onError: (err: Error) => {
      setDropError(err.message);
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  function onEventClick(arg: EventClickArg) {
    const note = arg.event.extendedProps.note as Note;
    setSelected(note);
  }

  function onEventDrop(arg: EventDropArg) {
    const note = arg.event.extendedProps.note as Note;
    const drop = arg.event.start;
    if (!drop) {
      arg.revert();
      return;
    }
    const starts_at = relocateKeepWallTime(note.starts_at, drop, user.timezone);
    patchDrop.mutate(
      { note, starts_at },
      {
        onError: () => arg.revert(),
      },
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
            note={selected}
            onClose={() => setSelected(null)}
            onSaved={(n) => {
              setSelected(n);
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
