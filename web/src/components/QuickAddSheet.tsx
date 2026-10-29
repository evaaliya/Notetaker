import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, User } from "../api";
import { ReminderOffsetsField } from "./ReminderOffsetsField";
import { TagPill } from "./TagPill";
import { localInputToUtcIso, utcIsoToLocalInput } from "../format";

type Props = {
  user: User;
  open: boolean;
  onClose: () => void;
};

export function QuickAddSheet({ user, open, onClose }: Props) {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const [title, setTitle] = useState("");
  const [startsLocal, setStartsLocal] = useState(() =>
    utcIsoToLocalInput(new Date().toISOString(), user.timezone),
  );
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([10]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createNote({
        title,
        body: "",
        starts_at: localInputToUtcIso(startsLocal, user.timezone),
        tag_ids: tagIds,
        reminder_offsets: reminderOffsets,
      });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      setTitle("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" data-testid="quick-add-sheet" role="dialog" aria-modal="true">
      <form className="sheet card form-grid" onSubmit={submit}>
        <div className="sheet-handle" aria-hidden="true" />
        <h3>Новая заметка</h3>
        <label>
          Название
          <input
            data-testid="note-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Время
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
        <fieldset className="tag-pick">
          <legend>Теги</legend>
          <div className="filter-pills">
            {(tags.data ?? []).map((t) => {
              const on = tagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={on ? "pill on" : "pill"}
                  onClick={() =>
                    setTagIds((prev) =>
                      on ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                    )
                  }
                >
                  <TagPill name={t.name} color={t.color} />
                </button>
              );
            })}
          </div>
        </fieldset>
        {error && <p className="error">{error}</p>}
        <div className="row-actions">
          <button type="submit" className="btn-accent" disabled={busy} data-testid="quick-add-submit">
            Добавить
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}
