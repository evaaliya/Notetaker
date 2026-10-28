import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Note, Tag, User } from "../api";
import { NoteIllustration } from "../components/NoteIllustration";
import { TagPill } from "../components/TagPill";
import { formatInZone } from "../format";
import { useNow } from "../hooks/useNow";

const PURGE_MS = 30 * 24 * 60 * 60 * 1000;

function daysLeft(deletedAt: string, now: Date): number {
  const gone = new Date(deletedAt).getTime() + PURGE_MS;
  return Math.max(0, Math.ceil((gone - now.getTime()) / (24 * 60 * 60 * 1000)));
}

function progress(deletedAt: string, now: Date): number {
  const start = new Date(deletedAt).getTime();
  const elapsed = now.getTime() - start;
  return Math.min(1, Math.max(0, elapsed / PURGE_MS));
}

export function TrashPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const tagsQ = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const tags = tagsQ.data ?? [];
  const trash = useQuery({ queryKey: ["trash"], queryFn: api.trash });
  const now = useNow(null);
  const restore = useMutation({
    mutationFn: (id: string) => api.restoreNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
    },
  });

  // Permanent delete is not in API (auto-purge only) — keep restore as primary action.
  // TODO(spec-gap): no DELETE forever endpoint; button omitted.

  return (
    <section className="trash-page">
      <div className="page-head">
        <div>
          <h1>Корзина</h1>
          <div className="mut">Заметки хранятся 30 дней, затем удаляются навсегда</div>
        </div>
      </div>
      {trash.isLoading && <p className="muted">Загрузка…</p>}
      {!trash.isLoading && (trash.data?.length ?? 0) === 0 && (
        <p className="muted">Пусто. Удалённые заметки хранятся 30 дней.</p>
      )}
      <ul className="note-list trash-list">
        {(trash.data ?? []).map((n) => (
          <TrashRow
            key={n.id}
            note={n}
            tags={tags}
            user={user}
            now={now}
            onRestore={() => restore.mutate(n.id)}
            busy={restore.isPending}
          />
        ))}
      </ul>
      <p className="muted small trash-footnote">
        Через 30 дней после удаления воркер очищает корзину автоматически.
      </p>
    </section>
  );
}

function TrashRow({
  note,
  tags,
  user,
  now,
  onRestore,
  busy,
}: {
  note: Note;
  tags: Tag[];
  user: User;
  now: Date;
  onRestore: () => void;
  busy: boolean;
}) {
  const first = note.tag_ids
    .map((id) => tags.find((t) => t.id === id))
    .find(Boolean);
  const left = note.deleted_at ? daysLeft(note.deleted_at, now) : 30;
  const pct = note.deleted_at ? progress(note.deleted_at, now) : 0;

  return (
    <li className="note-row trash-row card">
      <NoteIllustration
        title={note.title}
        body={note.body}
        tagName={first?.name}
        tagColor={first?.color}
        size={44}
      />
      <div className="note-main" style={{ cursor: "default" }}>
        <strong>{note.title || "Без названия"}</strong>
        <div className="muted small">
          исчезнет через {left} дн.
          {note.deleted_at
            ? ` · удалено ${formatInZone(note.deleted_at, user.timezone)}`
            : ""}
        </div>
        <div className="trash-progress" aria-hidden="true">
          <span style={{ width: `${pct * 100}%` }} />
        </div>
        {first && <TagPill name={first.name} color={first.color} />}
      </div>
      <div className="note-actions">
        <button type="button" onClick={onRestore} disabled={busy}>
          Восстановить
        </button>
      </div>
    </li>
  );
}
