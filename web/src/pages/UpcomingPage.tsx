import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Note, Occurrence, Upcoming, User } from "../api";
import { NoteSidePanel } from "../components/NoteSidePanel";
import { formatInZone } from "../format";
import { useNow } from "../hooks/useNow";

/** Move occurrences whose start has passed into past without reload (T16). */
export function liveBuckets(data: Upcoming, now: Date): Upcoming {
  const nowMs = now.getTime();
  const today: Occurrence[] = [];
  const week: Occurrence[] = [];
  const pastMap = new Map<string, Occurrence>();

  for (const it of data.past) {
    pastMap.set(`${it.note.id}:${it.occurrence_start}`, it);
  }

  const consider = (it: Occurrence, bucket: "today" | "week") => {
    if (new Date(it.occurrence_start).getTime() < nowMs) {
      pastMap.set(`${it.note.id}:${it.occurrence_start}`, it);
    } else if (bucket === "today") {
      today.push(it);
    } else {
      week.push(it);
    }
  };

  for (const it of data.today) consider(it, "today");
  for (const it of data.week) consider(it, "week");

  const past = [...pastMap.values()].sort(
    (a, b) => new Date(b.occurrence_start).getTime() - new Date(a.occurrence_start).getTime(),
  );
  return { today, week, past };
}

export function UpcomingPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const upcoming = useQuery({ queryKey: ["upcoming"], queryFn: api.upcoming });
  const [selected, setSelected] = useState<{
    note: Note;
    originalStart: string | null;
  } | null>(null);

  const nearest = useMemo(() => {
    if (!upcoming.data) return null;
    const future = [...upcoming.data.today, ...upcoming.data.week]
      .map((o) => o.occurrence_start)
      .filter((s) => new Date(s).getTime() > Date.now())
      .sort();
    return future[0] ?? null;
  }, [upcoming.data]);

  const now = useNow(nearest);
  const buckets = useMemo(
    () => (upcoming.data ? liveBuckets(upcoming.data, now) : null),
    [upcoming.data, now],
  );

  return (
    <section className="upcoming-page">
      <div className="list-toolbar">
        <h2>Ближайшее</h2>
      </div>

      <div className={`calendar-layout${selected ? " with-panel" : ""}`}>
        <div className="upcoming-sections">
          {upcoming.isLoading && <p className="muted">Загрузка…</p>}
          {buckets && (
            <>
              <Bucket
                title="Сегодня"
                items={buckets.today}
                timeZone={user.timezone}
                onPick={(it) =>
                  setSelected({
                    note: it.note,
                    originalStart: it.note.rec_freq ? it.original_start : null,
                  })
                }
                testId="bucket-today"
              />
              <Bucket
                title="Неделя"
                items={buckets.week}
                timeZone={user.timezone}
                onPick={(it) =>
                  setSelected({
                    note: it.note,
                    originalStart: it.note.rec_freq ? it.original_start : null,
                  })
                }
                testId="bucket-week"
              />
              <Bucket
                title="Прошедшие"
                items={buckets.past}
                timeZone={user.timezone}
                onPick={(it) =>
                  setSelected({
                    note: it.note,
                    originalStart: it.note.rec_freq ? it.original_start : null,
                  })
                }
                testId="bucket-past"
              />
            </>
          )}
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
  testId,
}: {
  title: string;
  items: Occurrence[];
  timeZone: string;
  onPick: (it: Occurrence) => void;
  testId: string;
}) {
  return (
    <div className="card upcoming-bucket" data-testid={testId}>
      <h3>
        {title}{" "}
        <span className="muted small">({items.length})</span>
      </h3>
      {items.length === 0 && <p className="muted small">Пусто</p>}
      <ul className="note-list">
        {items.map((it) => (
          <li
            key={`${it.note.id}-${it.original_start}`}
            className="note-row"
            data-note-title={it.note.title}
          >
            <button type="button" className="note-main linkish" onClick={() => onPick(it)}>
              <strong>{it.note.title || "Без названия"}</strong>
              <span className="muted small">
                {formatInZone(it.occurrence_start, timeZone)}
                {it.note.rec_freq ? " · повтор" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
