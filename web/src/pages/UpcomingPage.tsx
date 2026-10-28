import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Note, Occurrence, Tag, Upcoming, User } from "../api";
import { NoteIllustration } from "../components/NoteIllustration";
import { NoteSidePanel } from "../components/NoteSidePanel";
import { TagPill } from "../components/TagPill";
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

function resolveTag(note: Note, tags: Tag[]): Tag | undefined {
  const id = note.tag_ids[0];
  return id ? tags.find((t) => t.id === id) : undefined;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "сейчас";
  const totalMin = Math.ceil(ms / 60_000);
  if (totalMin < 60) return `через ${totalMin} ${pluralMin(totalMin)}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `через ${h} ч`;
  return `через ${h} ч ${m} мин`;
}

function pluralMin(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "минуту";
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return "минуты";
  return "минут";
}

export function UpcomingPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const tags = tagsQ.data ?? [];
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

  const hero = useMemo(() => {
    if (!buckets) return null;
    const pool = [...buckets.today, ...buckets.week].sort(
      (a, b) =>
        new Date(a.occurrence_start).getTime() - new Date(b.occurrence_start).getTime(),
    );
    return pool[0] ?? null;
  }, [buckets]);

  const laterToday = useMemo(() => {
    if (!buckets || !hero) return buckets?.today ?? [];
    return buckets.today.filter(
      (it) =>
        !(
          it.note.id === hero.note.id && it.occurrence_start === hero.occurrence_start
        ),
    );
  }, [buckets, hero]);

  const done = useMutation({
    mutationFn: (n: Note) => api.deactivateNote(n.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  const snooze = useMutation({
    mutationFn: async (it: Occurrence) => {
      const next = new Date(new Date(it.occurrence_start).getTime() + 10 * 60_000);
      const starts_at = next.toISOString().replace(/\.\d{3}Z$/, "Z");
      if (it.note.rec_freq) {
        return api.patchNote(
          it.note.id,
          { version: it.note.version, starts_at },
          { scope: "this", occurrence_start: it.original_start },
        );
      }
      return api.patchNote(it.note.id, { version: it.note.version, starts_at });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  const heroTag = hero ? resolveTag(hero.note, tags) : undefined;
  const countdownMs = hero
    ? new Date(hero.occurrence_start).getTime() - now.getTime()
    : 0;

  const todayLabel = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: user.timezone,
  }).format(now);

  return (
    <section className="upcoming-page">
      <div className="page-head">
        <div>
          <h1>Ближайшее</h1>
          <div className="mut" style={{ textTransform: "capitalize" }}>
            {todayLabel}
          </div>
        </div>
      </div>

      <div className={`calendar-layout${selected ? " with-panel" : ""}`}>
        <div className="upcoming-sections">
          {upcoming.isLoading && <p className="muted">Загрузка…</p>}
          {hero && (
            <div className="upcoming-hero card" data-testid="upcoming-hero">
              <div>
                <div className="lab" style={{ color: "var(--accent)" }}>
                  Следующее напоминание
                </div>
                <h2 className="hero-title">{hero.note.title || "Без названия"}</h2>
                <div className="hero-meta">
                  {heroTag && <TagPill name={heroTag.name} color={heroTag.color} />}
                  <span className="muted">
                    {formatInZone(hero.occurrence_start, user.timezone)}
                    {hero.note.reminder_offsets?.[0] != null
                      ? ` · напоминание за ${hero.note.reminder_offsets[0]} мин`
                      : ""}
                  </span>
                </div>
                <div className="hero-countdown" data-testid="hero-countdown">
                  {formatCountdown(countdownMs)}
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="btn-accent"
                    onClick={() => done.mutate(hero.note)}
                    disabled={done.isPending}
                  >
                    Готово
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => snooze.mutate(hero)}
                    disabled={snooze.isPending}
                  >
                    Отложить на 10 минут
                  </button>
                </div>
              </div>
              <NoteIllustration
                title={hero.note.title}
                body={hero.note.body}
                tagName={heroTag?.name}
                tagColor={heroTag?.color}
                size={120}
                className="hero-illu"
              />
            </div>
          )}

          {buckets && (
            <>
              <Bucket
                title="Позже сегодня"
                items={laterToday}
                tags={tags}
                timeZone={user.timezone}
                onPick={(it) =>
                  setSelected({
                    note: it.note,
                    originalStart: it.note.rec_freq ? it.original_start : null,
                  })
                }
                testId="bucket-today"
              />
              <div className="lab section-lab">На этой неделе</div>
              <div className="week-grid" data-testid="bucket-week">
                {buckets.week.length === 0 && <p className="muted small">Пусто</p>}
                {buckets.week.map((it) => {
                  const tag = resolveTag(it.note, tags);
                  return (
                    <button
                      key={`${it.note.id}-${it.original_start}`}
                      type="button"
                      className="card week-card"
                      data-note-title={it.note.title}
                      onClick={() =>
                        setSelected({
                          note: it.note,
                          originalStart: it.note.rec_freq ? it.original_start : null,
                        })
                      }
                    >
                      <NoteIllustration
                        title={it.note.title}
                        body={it.note.body}
                        tagName={tag?.name}
                        tagColor={tag?.color}
                        size={84}
                        className="week-illu"
                      />
                      <b>{it.note.title || "Без названия"}</b>
                      <div className="mut">
                        {formatInZone(it.occurrence_start, user.timezone)}
                      </div>
                      {tag && (
                        <div style={{ marginTop: 8 }}>
                          <TagPill name={tag.name} color={tag.color} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <Bucket
                title="Прошедшие"
                items={buckets.past}
                tags={tags}
                timeZone={user.timezone}
                past
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
            tags={tags}
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
  tags,
  timeZone,
  onPick,
  testId,
  past = false,
}: {
  title: string;
  items: Occurrence[];
  tags: Tag[];
  timeZone: string;
  onPick: (it: Occurrence) => void;
  testId: string;
  past?: boolean;
}) {
  return (
    <div>
      <div className="lab section-lab">
        {title}{" "}
        <span className="muted" style={{ letterSpacing: 0, textTransform: "none" }}>
          ({items.length})
        </span>
      </div>
      <div className={`card upcoming-bucket${past ? " past" : ""}`} data-testid={testId}>
        {items.length === 0 && <p className="muted small">Пусто</p>}
        <ul className="note-list">
          {items.map((it) => {
            const tag = resolveTag(it.note, tags);
            return (
              <li
                key={`${it.note.id}-${it.original_start}`}
                className="note-row upcoming-row"
                data-note-title={it.note.title}
              >
                <NoteIllustration
                  title={it.note.title}
                  body={it.note.body}
                  tagName={tag?.name}
                  tagColor={tag?.color}
                  size={44}
                />
                <button type="button" className="note-main linkish" onClick={() => onPick(it)}>
                  <strong>{it.note.title || "Без названия"}</strong>
                  <span className="muted small">
                    {formatInZone(it.occurrence_start, timeZone)}
                    {it.note.rec_freq ? " · повтор" : ""}
                    {past ? (
                      <>
                        {" · "}
                        <span className="overdue">просрочено</span>
                      </>
                    ) : null}
                  </span>
                </button>
                {tag && <TagPill name={tag.name} color={tag.color} />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
