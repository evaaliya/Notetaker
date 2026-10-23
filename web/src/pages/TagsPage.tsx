import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Tag } from "../api";

export function TagsPage() {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0F6B5C");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createTag({ name, color }),
    onSuccess: () => {
      setName("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });

  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; color?: string }) =>
      api.patchTag(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <section>
      <h2>Теги</h2>
      <form className="card form-grid" onSubmit={onCreate}>
        <label>
          Имя
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Цвет
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={create.isPending}>
          Добавить
        </button>
      </form>
      {tags.isLoading && <p className="muted">Загрузка…</p>}
      <ul className="tag-list">
        {(tags.data ?? []).map((t) => (
          <TagRow
            key={t.id}
            tag={t}
            onDelete={() => remove.mutate(t.id)}
            onSave={(body) => patch.mutate({ id: t.id, ...body })}
          />
        ))}
      </ul>
    </section>
  );
}

function TagRow({
  tag,
  onDelete,
  onSave,
}: {
  tag: Tag;
  onDelete: () => void;
  onSave: (body: { name?: string; color?: string }) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);

  return (
    <li className="tag-row">
      <span className="tag-swatch" style={{ background: tag.color }} />
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      <button
        type="button"
        className="secondary"
        onClick={() => onSave({ name, color })}
        disabled={name === tag.name && color === tag.color}
      >
        Сохранить
      </button>
      <button type="button" className="link" onClick={onDelete}>
        Удалить
      </button>
    </li>
  );
}
