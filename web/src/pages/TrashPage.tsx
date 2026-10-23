import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, User } from "../api";
import { formatInZone } from "../format";

export function TrashPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const trash = useQuery({ queryKey: ["trash"], queryFn: api.trash });
  const restore = useMutation({
    mutationFn: (id: string) => api.restoreNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });

  return (
    <section>
      <h2>Корзина</h2>
      {trash.isLoading && <p className="muted">Загрузка…</p>}
      {!trash.isLoading && (trash.data?.length ?? 0) === 0 && (
        <p className="muted">Пусто. Удалённые заметки хранятся 30 дней.</p>
      )}
      <ul className="note-list">
        {(trash.data ?? []).map((n) => (
          <li key={n.id} className="note-row">
            <div>
              <strong>{n.title || "Без названия"}</strong>
              <div className="muted small">
                удалено{" "}
                {n.deleted_at ? formatInZone(n.deleted_at, user.timezone) : "—"}
              </div>
            </div>
            <button type="button" onClick={() => restore.mutate(n.id)} disabled={restore.isPending}>
              Восстановить
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
