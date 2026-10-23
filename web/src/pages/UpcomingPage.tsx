import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Note, Occurrence, User } from "../api";
import { NoteSidePanel } from "../components/NoteSidePanel";
import { formatInZone } from "../format";

export function UpcomingPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const upcoming = useQuery({ queryKey: ["upcoming"], queryFn: api.upcoming });
  const [selected, setSelected] = useState<Note | null>(null);

  return (
    <section className="upcoming-page">
      <div className="list-toolbar">
        <h2>Ближайшее</h2>
        <span className="muted small">без live-перехода · M4</span>
      </div>

      <div className={`calendar-layout${selected ? " with-panel" : ""}`}>
        <div className="upcoming-sections">
          {upcoming.isLoading && <p className="muted">Загрузка…</p>}
          {upcoming.data && (
            <>
              <Bucket
                title="Сегодня"
                items={upcoming.data.today}
                timeZone={user.timezone}
                onPick={setSelected}
              />
              <Bucket
                title="Неделя"
                items={upcoming.data.week}
                timeZone={user.timezone}
                onPick={setSelected}
              />
              <Bucket
                title="Прошедшие"
                items={upcoming.data.past}
                timeZone={user.timezone}
                onPick={setSelected}
              />
            </>
          )}
        </div>
        {selected && (
          <NoteSidePanel
            user={user}
            tags={tags.data ?? []}
            note={selected}
            onClose={() => setSelected(null)}
            onSaved={(n) => {
              setSelected(n);
              qc.invalidateQueries({ queryKey: ["upcoming"] });
              qc.invalidateQueries({ queryKey: ["calendar"] });
              qc.invalidateQueries({ queryKey: ["notes"] });
            }}
          />
        )}
      </div>
    </section>
  );
}

function Bucket({
  title,
  items,
  timeZone,
  onPick,
}: {
  title: string;
  items: Occurrence[];
  timeZone: string;
  onPick: (n: Note) => void;
}) {
  return (
    <div className="card upcoming-bucket">
      <h3>
        {title}{" "}
        <span className="muted small">({items.length})</span>
      </h3>
      {items.length === 0 && <p className="muted small">Пусто</p>}
      <ul className="note-list">
        {items.map((it) => (
          <li key={`${it.note.id}-${it.occurrence_start}`} className="note-row">
            <button type="button" className="note-main linkish" onClick={() => onPick(it.note)}>
              <strong>{it.note.title || "Без названия"}</strong>
              <span className="muted small">
                {formatInZone(it.occurrence_start, timeZone)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
