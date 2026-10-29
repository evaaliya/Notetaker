import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, Note, Recurrence, Tag, User } from "../api";
import { NoteIllustration } from "../components/NoteIllustration";
import { RecurrenceField } from "../components/RecurrenceField";
import { ReminderOffsetsField } from "../components/ReminderOffsetsField";
import { Switch } from "../components/Switch";
import { TagPill } from "../components/TagPill";
import { formatInZone, localInputToUtcIso, utcIsoToLocalInput } from "../format";
import { useQuickAdd } from "../hooks/useQuickAdd";

type Filters = {
  q: string;
  status: string;
  tagId: string;
  sort: "starts_at" | "updated_at";
  dir: "asc" | "desc";
};

export function ListPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const quickAdd = useQuickAdd();
  const [searchParams] = useSearchParams();
  const tagFromUrl = searchParams.get("tag") ?? "";
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const [filters, setFilters] = useState<Filters>({
    q: "",
    status: "",
    tagId: tagFromUrl,
    sort: "starts_at",
    dir: "asc",
  });
  const [draft, setDraft] = useState<Filters>(filters);

  useEffect(() => {
    if (tagFromUrl === filters.tagId) return;
    const next = { ...filters, tagId: tagFromUrl };
    setFilters(next);
    setDraft(next);
  }, [tagFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState<Note | null>(null);
  const [creating, setCreating] = useState(false);

  const listQuery = useInfiniteQuery({
    queryKey: ["notes", filters],
    queryFn: ({ pageParam }) =>
      api.listNotes({
        q: filters.q || undefined,
        status: filters.status || undefined,
        tags: filters.tagId ? [filters.tagId] : undefined,
        sort: filters.sort,
        dir: filters.dir,
        cursor: pageParam,
        limit: 40,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const notes = useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [listQuery.data],
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 8,
  });

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    setFilters(draft);
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
  });

  const toggle = useMutation({
    mutationFn: (n: Note) =>
      n.status === "active" ? api.deactivateNote(n.id) : api.activateNote(n.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes"] }),
  });

  const tagList = tags.data ?? [];

  return (
    <section className="list-page">
      <div className="page-head">
        <div>
          <h1>Список</h1>
          <div className="mut">Поиск и фильтры на сервере</div>
        </div>
        <div className="page-head-actions">
          <input
            className="search-input"
            placeholder="Поиск"
            aria-label="Поиск"
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setFilters(draft);
              }
            }}
          />
          <button
            type="button"
            className="btn-accent"
            data-testid="new-note"
            onClick={() => {
              if (window.matchMedia("(max-width: 640px)").matches) {
                quickAdd.show();
                return;
              }
              setCreating(true);
              setEditing(null);
            }}
          >
            Новая заметка
          </button>
        </div>
      </div>

      <form className="filters card" onSubmit={applyFilters}>
        <div className="filter-pills">
          <button
            type="button"
            className={!draft.tagId ? "pill on" : "pill"}
            onClick={() => setDraft({ ...draft, tagId: "" })}
          >
            Все теги
          </button>
          {tagList.map((t) => (
            <button
              key={t.id}
              type="button"
              className={draft.tagId === t.id ? "pill on" : "pill"}
              onClick={() => setDraft({ ...draft, tagId: t.id })}
            >
              <TagPill name={t.name} color={t.color} />
            </button>
          ))}
        </div>
        <select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="">Все статусы</option>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
        <select
          value={`${draft.sort}:${draft.dir}`}
          onChange={(e) => {
            const [sort, dir] = e.target.value.split(":") as [
              Filters["sort"],
              Filters["dir"],
            ];
            setDraft({ ...draft, sort, dir });
          }}
        >
          <option value="starts_at:asc">дата ↑</option>
          <option value="starts_at:desc">дата ↓</option>
          <option value="updated_at:desc">изменены ↓</option>
          <option value="updated_at:asc">изменены ↑</option>
        </select>
        <button type="submit">Применить</button>
      </form>

      {(creating || editing) && (
        <NoteForm
          user={user}
          tags={tags.data ?? []}
          note={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["notes"] });
          }}
        />
      )}

      <div
        ref={parentRef}
        className="virtual-list"
        onScroll={() => {
          const el = parentRef.current;
          if (!el || !listQuery.hasNextPage || listQuery.isFetchingNextPage) return;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
            listQuery.fetchNextPage();
          }
        }}
      >
        {listQuery.isLoading && <p className="muted">Загрузка…</p>}
        {!listQuery.isLoading && notes.length === 0 && (
          <p className="muted">Нет заметок по фильтру.</p>
        )}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const n = notes[row.index];
            const noteTags = n.tag_ids
              .map((id) => tagList.find((t) => t.id === id))
              .filter(Boolean) as Tag[];
            const first = noteTags[0];
            const offsets =
              n.reminder_offsets?.length > 0
                ? `напоминание за ${n.reminder_offsets.join("/")} мин`
                : null;
            return (
              <div
                key={n.id}
                className="note-row virtual-row list-row"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${row.size}px`,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <NoteIllustration
                  title={n.title}
                  body={n.body}
                  tagName={first?.name}
                  tagColor={first?.color}
                  size={44}
                />
                <button
                  type="button"
                  className="note-main linkish"
                  onClick={() => {
                    setEditing(n);
                    setCreating(false);
                  }}
                >
                  <strong>{n.title || "Без названия"}</strong>
                  {n.body ? (
                    <span className="muted small list-body-preview">
                      {n.body.split("\n")[0]}
                    </span>
                  ) : null}
                  <span
                    className="muted small"
                    data-testid="note-starts-display"
                    data-note-id={n.id}
                  >
                    {formatInZone(n.starts_at, user.timezone)}
                    {n.rec_freq ? " · повтор" : ""}
                    {offsets ? ` · ${offsets}` : ""}
                  </span>
                  {noteTags.length > 0 && (
                    <span className="list-tags">
                      {noteTags.map((t) => (
                        <TagPill key={t.id} name={t.name} color={t.color} />
                      ))}
                    </span>
                  )}
                </button>
                <div className="note-actions">
                  <Switch
                    label={n.status === "active" ? "Активна" : "Неактивна"}
                    checked={n.status === "active"}
                    onChange={() => toggle.mutate(n)}
                  />
                  <button type="button" className="link" onClick={() => remove.mutate(n.id)}>
                    В корзину
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {listQuery.isFetchingNextPage && <p className="muted small">Ещё…</p>}
      </div>
    </section>
  );
}

function NoteForm({
  user,
  tags,
  note,
  onClose,
  onSaved,
}: {
  user: User;
  tags: Tag[];
  note: Note | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [startsLocal, setStartsLocal] = useState(
    note
      ? utcIsoToLocalInput(note.starts_at, user.timezone)
      : utcIsoToLocalInput(new Date().toISOString(), user.timezone),
  );
  const [tagIds, setTagIds] = useState<string[]>(note?.tag_ids ?? []);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>(
    note?.reminder_offsets ?? [],
  );
  const [recurrence, setRecurrence] = useState<Recurrence | null>(() =>
    note?.rec_freq
      ? {
          freq: note.rec_freq as Recurrence["freq"],
          until: note.rec_until,
          tz: note.rec_tz || user.timezone,
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const starts_at = localInputToUtcIso(startsLocal, user.timezone);
      if (note) {
        await api.patchNote(note.id, {
          version: note.version,
          title,
          body,
          starts_at,
          tag_ids: tagIds,
          reminder_offsets: reminderOffsets,
          recurrence: recurrence,
        });
      } else {
        await api.createNote({
          title,
          body,
          starts_at,
          tag_ids: tagIds,
          reminder_offsets: reminderOffsets,
          ...(recurrence ? { recurrence } : {}),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <form className="card form-grid" onSubmit={submit} data-testid="note-form">
      <h3>{note ? "Редактировать" : "Новая заметка"}</h3>
      <label>
        Заголовок
        <input
          data-testid="note-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Текст
        <textarea
          data-testid="note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
        />
      </label>
      <label>
        Время
        <span className="muted small" data-testid="note-tz-hint">
          {" "}
          (ввод в поясе {user.timezone})
        </span>
        <input
          type="datetime-local"
          data-testid="note-starts"
          value={startsLocal}
          onChange={(e) => setStartsLocal(e.target.value)}
          required
        />
      </label>
      <ReminderOffsetsField
        value={reminderOffsets}
        onChange={setReminderOffsets}
        startsLocal={startsLocal}
        timeZone={user.timezone}
      />
      <RecurrenceField
        value={recurrence}
        onChange={setRecurrence}
        timeZone={user.timezone}
        lockedTz={note?.rec_tz}
      />
      <fieldset className="tag-pick">
        <legend>Теги</legend>
        {tags.map((t) => (
          <label key={t.id} className="inline">
            <input
              type="checkbox"
              checked={tagIds.includes(t.id)}
              onChange={() => toggleTag(t.id)}
            />
            <span className="tag-swatch tiny" style={{ background: t.color }} />
            {t.name}
          </label>
        ))}
      </fieldset>
      {error && <p className="error">{error}</p>}
      <div className="row-actions">
        <button type="submit" disabled={busy}>
          Сохранить
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}
