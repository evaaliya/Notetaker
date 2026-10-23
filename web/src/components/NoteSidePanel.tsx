import { FormEvent, useEffect, useState } from "react";
import { api, Note, Tag, User } from "../api";
import { localInputToUtcIso, utcIsoToLocalInput } from "../format";

type Props = {
  user: User;
  tags: Tag[];
  note: Note;
  onClose: () => void;
  onSaved: (note: Note) => void;
};

export function NoteSidePanel({ user, tags, note, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [startsLocal, setStartsLocal] = useState(
    utcIsoToLocalInput(note.starts_at, user.timezone),
  );
  const [tagIds, setTagIds] = useState<string[]>(note.tag_ids);
  const [version, setVersion] = useState(note.version);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
    setStartsLocal(utcIsoToLocalInput(note.starts_at, user.timezone));
    setTagIds(note.tag_ids);
    setVersion(note.version);
    setError(null);
  }, [note, user.timezone]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patchNote(note.id, {
        version,
        title,
        body,
        starts_at: localInputToUtcIso(startsLocal, user.timezone),
        tag_ids: tagIds,
      });
      setVersion(updated.version);
      onSaved(updated);
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
    <aside className="side-panel card">
      <form className="form-grid" onSubmit={submit}>
        <div className="list-toolbar">
          <h3>Заметка</h3>
          <button type="button" className="secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <label>
          Заголовок
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Текст
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
        </label>
        <label>
          Время ({user.timezone})
          <input
            type="datetime-local"
            value={startsLocal}
            onChange={(e) => setStartsLocal(e.target.value)}
            required
          />
        </label>
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
        <button type="submit" disabled={busy}>
          Сохранить
        </button>
      </form>
    </aside>
  );
}
