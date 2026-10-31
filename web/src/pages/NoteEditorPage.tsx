import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, Note, Recurrence, Tag, User } from "../api";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { ConflictDialog } from "../components/ConflictDialog";
import { NotesRail } from "../components/NotesRail";
import { RecurrenceField } from "../components/RecurrenceField";
import { ReminderOffsetsField } from "../components/ReminderOffsetsField";
import { localInputToUtcIso, utcIsoToLocalInput } from "../format";

type Props = { user: User };

export function NoteEditorPage({ user }: Props) {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const noteQuery = useQuery({
    queryKey: ["note", id],
    queryFn: () => api.getNote(id!),
    enabled: !isNew,
  });

  if (!isNew && noteQuery.isLoading) {
    return (
      <div className="notes-workspace" data-testid="note-editor-page">
        <NotesRail timeZone={user.timezone} />
        <div className="note-editor-pane">
          <p className="muted">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (!isNew && (noteQuery.isError || !noteQuery.data)) {
    return (
      <div className="notes-workspace" data-testid="note-editor-page">
        <NotesRail timeZone={user.timezone} />
        <div className="note-editor-pane">
          <p className="error">Заметка не найдена</p>
          <button type="button" className="secondary" onClick={() => navigate("/list")}>
            К списку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="notes-workspace" data-testid="note-editor-page">
      <NotesRail timeZone={user.timezone} />
      <NoteEditorForm
        key={isNew ? "new" : noteQuery.data!.id}
        user={user}
        tags={tags.data ?? []}
        note={isNew ? null : noteQuery.data!}
        onCancel={() => navigate("/list")}
        onSaved={(n) => {
          qc.invalidateQueries({ queryKey: ["notes"] });
          qc.invalidateQueries({ queryKey: ["note", n.id] });
          qc.invalidateQueries({ queryKey: ["calendar"] });
          qc.invalidateQueries({ queryKey: ["upcoming"] });
          if (isNew) navigate(`/notes/${n.id}`, { replace: true });
        }}
      />
    </div>
  );
}

function NoteEditorForm({
  user,
  tags,
  note,
  onCancel,
  onSaved,
}: {
  user: User;
  tags: Tag[];
  note: Note | null;
  onCancel: () => void;
  onSaved: (n: Note) => void;
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
  const [version, setVersion] = useState(note?.version ?? 1);
  const [baseline, setBaseline] = useState(note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflictNote, setConflictNote] = useState<Note | null>(null);

  useEffect(() => {
    if (!note) return;
    if (!baseline || note.id !== baseline.id) {
      setTitle(note.title);
      setBody(note.body);
      setStartsLocal(utcIsoToLocalInput(note.starts_at, user.timezone));
      setTagIds([...note.tag_ids]);
      setReminderOffsets([...(note.reminder_offsets ?? [])]);
      setVersion(note.version);
      setBaseline(note);
      setRecurrence(
        note.rec_freq
          ? {
              freq: note.rec_freq as Recurrence["freq"],
              until: note.rec_until,
              tz: note.rec_tz || user.timezone,
            }
          : null,
      );
    }
  }, [note, baseline, user.timezone]);

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const starts_at = localInputToUtcIso(startsLocal, user.timezone);
      let saved: Note;
      if (note) {
        saved = await api.patchNote(note.id, {
          version,
          title,
          body,
          starts_at,
          tag_ids: tagIds,
          reminder_offsets: reminderOffsets,
          recurrence,
        });
      } else {
        saved = await api.createNote({
          title,
          body,
          starts_at,
          tag_ids: tagIds,
          reminder_offsets: reminderOffsets,
          ...(recurrence ? { recurrence } : {}),
        });
      }
      setVersion(saved.version);
      setBaseline(saved);
      setConflictNote(null);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.note) {
        setConflictNote(err.note);
      } else {
        setError(err instanceof Error ? err.message : "Ошибка");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveMine(server: Note) {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.patchNote(note!.id, {
        version: server.version,
        title,
        body,
        starts_at: localInputToUtcIso(startsLocal, user.timezone),
        tag_ids: tagIds,
        reminder_offsets: reminderOffsets,
        recurrence,
      });
      setVersion(saved.version);
      setBaseline(saved);
      setConflictNote(null);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function acceptServer(server: Note) {
    setTitle(server.title);
    setBody(server.body);
    setStartsLocal(utcIsoToLocalInput(server.starts_at, user.timezone));
    setTagIds([...server.tag_ids]);
    setReminderOffsets([...(server.reminder_offsets ?? [])]);
    setVersion(server.version);
    setBaseline(server);
    setConflictNote(null);
    onSaved(server);
  }

  return (
    <div className="note-editor-pane">
      <form className="note-editor-form" onSubmit={submit} data-testid="note-form">
        <header className="note-editor-bar">
          <h1 className="note-editor-heading">{note ? "Заметка" : "Новая заметка"}</h1>
          <div className="note-editor-actions">
            <button type="submit" className="btn-accent" disabled={busy} data-testid="note-save">
              Сохранить
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              Отмена
            </button>
          </div>
        </header>

        <div className="note-editor-body">
          <label>
            Название
            <input
              data-testid="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="note-body-field">
            Текст
            <textarea
              data-testid="note-body"
              className="note-body-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
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
          <RecurrenceField
            value={recurrence}
            onChange={setRecurrence}
            timeZone={user.timezone}
            lockedTz={note?.rec_tz}
          />
          <ReminderOffsetsField
            value={reminderOffsets}
            onChange={setReminderOffsets}
            startsLocal={startsLocal}
            timeZone={user.timezone}
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

          <AttachmentsPanel noteId={note?.id ?? null} />

          {error && <p className="error">{error}</p>}
        </div>
      </form>
      {conflictNote && (
        <ConflictDialog
          draft={{ title, body, startsLocal }}
          server={conflictNote}
          timeZone={user.timezone}
          formatStarts={(iso) => utcIsoToLocalInput(iso, user.timezone)}
          onMine={() => void saveMine(conflictNote)}
          onTheirs={() => acceptServer(conflictNote)}
          onClose={() => setConflictNote(null)}
        />
      )}
    </div>
  );
}
