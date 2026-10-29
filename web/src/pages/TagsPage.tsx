import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Tag } from "../api";
import { TagPill } from "../components/TagPill";
import { TAG_PALETTE } from "../lib/tagPalette";

export function TagsPage() {
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_PALETTE[0]);
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
    <section className="tags-page">
      <div className="page-head">
        <div>
          <h1>Теги</h1>
          <div className="mut">Цвет и имя · уникальны без учёта регистра</div>
        </div>
      </div>

      <div className="tags-layout">
        <div>
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
        </div>

        <form className="card form-grid tag-create" onSubmit={onCreate}>
          <h3>Новый тег</h3>
          <label>
            Имя
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <div className="lab">Цвет</div>
          <div className="color-palette" role="listbox" aria-label="Палитра">
            {TAG_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={color === c}
                className={`color-swatch${color === c ? " selected" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
          <TagPill name={name || "Тег"} color={color} />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-accent" disabled={create.isPending}>
            Добавить
          </button>
        </form>
      </div>
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
  const [renaming, setRenaming] = useState(false);

  const palette = TAG_PALETTE.includes(color as (typeof TAG_PALETTE)[number])
    ? TAG_PALETTE
    : ([color, ...TAG_PALETTE] as string[]);

  return (
    <li className="tag-row card">
      <span className="tag-square" style={{ background: tag.color }} aria-hidden="true" />
      {renaming ? (
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Имя тега" />
      ) : (
        <TagPill name={tag.name} color={tag.color} />
      )}
      <div className="color-palette compact">
        {palette.map((c) => (
          <button
            key={c}
            type="button"
            className={`color-swatch${color === c ? " selected" : ""}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={c}
          />
        ))}
      </div>
      <div className="note-actions">
        {renaming ? (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              onSave({ name, color });
              setRenaming(false);
            }}
            disabled={name === tag.name && color === tag.color}
          >
            Сохранить
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setRenaming(true);
              if (color !== tag.color) onSave({ color });
            }}
          >
            Переименовать
          </button>
        )}
        {!renaming && color !== tag.color && (
          <button type="button" className="secondary" onClick={() => onSave({ color })}>
            Цвет
          </button>
        )}
        <button type="button" className="link" onClick={onDelete}>
          Удалить
        </button>
      </div>
    </li>
  );
}
