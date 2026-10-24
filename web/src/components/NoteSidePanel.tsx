import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, EditScope, api, Note, Tag, User } from "../api";
import { localInputToUtcIso, utcIsoToLocalInput } from "../format";
import { ConflictDialog } from "./ConflictDialog";
import { EditScopeDialog } from "./EditScopeDialog";
import { ReminderOffsetsField, offsetsEqual } from "./ReminderOffsetsField";

type Props = {
  user: User;
  tags: Tag[];
  note: Note;
  /** When editing a series occurrence from calendar/upcoming. */
  occurrenceOriginalStart?: string | null;
  onClose: () => void;
  onSaved: (note: Note) => void;
};

function formFromNote(note: Note, timeZone: string) {
  return {
    title: note.title,
    body: note.body,
    startsLocal: utcIsoToLocalInput(note.starts_at, timeZone),
    tagIds: [...note.tag_ids],
    reminderOffsets: [...(note.reminder_offsets ?? [])],
    version: note.version,
  };
}

export function NoteSidePanel({
  user,
  tags,
  note,
  occurrenceOriginalStart = null,
  onClose,
  onSaved,
}: Props) {
  const isSeriesOcc = Boolean(note.rec_freq && occurrenceOriginalStart);
  const initial = formFromNote(note, user.timezone);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [startsLocal, setStartsLocal] = useState(initial.startsLocal);
  const [tagIds, setTagIds] = useState(initial.tagIds);
  const [reminderOffsets, setReminderOffsets] = useState(initial.reminderOffsets);
  const [version, setVersion] = useState(initial.version);
  const [baseline, setBaseline] = useState(note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remoteBanner, setRemoteBanner] = useState(false);
  const [conflictNote, setConflictNote] = useState<Note | null>(null);
  const [pendingScope, setPendingScope] = useState<"save" | "delete" | null>(null);

  const dirty = useMemo(() => {
    const starts = localInputToUtcIso(startsLocal, user.timezone);
    const tagsSame =
      tagIds.length === baseline.tag_ids.length &&
      tagIds.every((id) => baseline.tag_ids.includes(id));
    return (
      title !== baseline.title ||
      body !== baseline.body ||
      starts !== baseline.starts_at ||
      !tagsSame ||
      !offsetsEqual(reminderOffsets, baseline.reminder_offsets ?? [])
    );
  }, [title, body, startsLocal, tagIds, reminderOffsets, baseline, user.timezone]);

  useEffect(() => {
    if (note.id !== baseline.id) {
      const f = formFromNote(note, user.timezone);
      setTitle(f.title);
      setBody(f.body);
      setStartsLocal(f.startsLocal);
      setTagIds(f.tagIds);
      setReminderOffsets(f.reminderOffsets);
      setVersion(f.version);
      setBaseline(note);
      setRemoteBanner(false);
      setConflictNote(null);
      setError(null);
      return;
    }
    if (note.version === baseline.version) return;
    if (!dirty) {
      const f = formFromNote(note, user.timezone);
      setTitle(f.title);
      setBody(f.body);
      setStartsLocal(f.startsLocal);
      setTagIds(f.tagIds);
      setReminderOffsets(f.reminderOffsets);
      setVersion(f.version);
      setBaseline(note);
      setRemoteBanner(false);
    } else {
      setRemoteBanner(true);
    }
  }, [note, baseline.id, baseline.version, dirty, user.timezone]);

  async function saveWithScope(scope: EditScope, v: number) {
    setBusy(true);
    setError(null);
    setPendingScope(null);
    try {
      const fields: Record<string, unknown> = {
        version: v,
        title,
        body,
        starts_at: localInputToUtcIso(startsLocal, user.timezone),
      };
      if (scope === "all" || scope === "following") {
        if (!isSeriesOcc || scope === "following") {
          fields.tag_ids = tagIds;
          fields.reminder_offsets = reminderOffsets;
        }
      }
      if (!isSeriesOcc) {
        fields.tag_ids = tagIds;
        fields.reminder_offsets = reminderOffsets;
      }
      const opts =
        scope === "all" || !occurrenceOriginalStart
          ? { scope: "all" as const }
          : { scope, occurrence_start: occurrenceOriginalStart };
      const updated = await api.patchNote(note.id, fields, opts);
      setVersion(updated.version);
      setBaseline(updated);
      setReminderOffsets([...(updated.reminder_offsets ?? [])]);
      setConflictNote(null);
      setRemoteBanner(false);
      onSaved(updated);
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isSeriesOcc) {
      setPendingScope("save");
      return;
    }
    await saveWithScope("all", version);
  }

  async function deleteOccurrence() {
    if (!occurrenceOriginalStart) return;
    setBusy(true);
    setError(null);
    setPendingScope(null);
    try {
      const updated = await api.deleteNote(note.id, {
        scope: "this",
        occurrence_start: occurrenceOriginalStart,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function acceptServer(server: Note) {
    const f = formFromNote(server, user.timezone);
    setTitle(f.title);
    setBody(f.body);
    setStartsLocal(f.startsLocal);
    setTagIds(f.tagIds);
    setReminderOffsets(f.reminderOffsets);
    setVersion(f.version);
    setBaseline(server);
    setConflictNote(null);
    setRemoteBanner(false);
    onSaved(server);
  }

  return (
    <aside className="side-panel card">
      <form className="form-grid" onSubmit={submit}>
        <div className="list-toolbar">
          <h3>{isSeriesOcc ? "Вхождение" : "Заметка"}</h3>
          <button type="button" className="secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {isSeriesOcc && (
          <p className="muted small" data-testid="series-occ-hint">
            Серия · {note.rec_freq}
            {note.rec_until ? ` до ${note.rec_until}` : ""} · ключ{" "}
            {occurrenceOriginalStart}
          </p>
        )}
        {remoteBanner && (
          <p className="banner" data-testid="remote-edit-banner">
            Заметка изменена на другом устройстве. При сохранении возможен конфликт.
          </p>
        )}
        <label>
          Заголовок
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Текст
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
        </label>
        <label>
          Время
          <span className="muted small" data-testid="note-tz-hint">
            {" "}
            (ввод в поясе {user.timezone})
          </span>
          <input
            type="datetime-local"
            value={startsLocal}
            onChange={(e) => setStartsLocal(e.target.value)}
            required
          />
        </label>
        {!isSeriesOcc && (
          <ReminderOffsetsField
            value={reminderOffsets}
            onChange={setReminderOffsets}
            startsLocal={startsLocal}
            timeZone={user.timezone}
          />
        )}
        {!isSeriesOcc && (
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
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy} data-testid="note-save">
          Сохранить
        </button>
        {isSeriesOcc && (
          <button
            type="button"
            className="link"
            data-testid="delete-occurrence"
            disabled={busy}
            onClick={() => setPendingScope("delete")}
          >
            Удалить это вхождение
          </button>
        )}
      </form>
      {pendingScope === "save" && (
        <EditScopeDialog
          onChoose={(scope) => saveWithScope(scope, version)}
          onClose={() => setPendingScope(null)}
        />
      )}
      {pendingScope === "delete" && (
        <div className="modal-backdrop" data-testid="delete-occ-confirm" role="dialog">
          <div className="modal card">
            <h3>Удалить вхождение?</h3>
            <p className="muted small">Остальные вхождения серии останутся.</p>
            <div className="form-grid">
              <button type="button" onClick={() => void deleteOccurrence()}>
                Удалить только это
              </button>
              <button type="button" className="secondary" onClick={() => setPendingScope(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
      {conflictNote && (
        <ConflictDialog
          draft={{ title, body, startsLocal }}
          server={conflictNote}
          timeZone={user.timezone}
          formatStarts={(iso) => utcIsoToLocalInput(iso, user.timezone)}
          onMine={() => saveWithScope(isSeriesOcc ? "this" : "all", conflictNote.version)}
          onTheirs={() => acceptServer(conflictNote)}
          onClose={() => setConflictNote(null)}
        />
      )}
    </aside>
  );
}
