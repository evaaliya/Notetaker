import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { Tag } from "../api";
import { TagPill } from "./TagPill";

type Props = {
  tags: Tag[];
  value: string[];
  onChange: (ids: string[]) => void;
};

const SEARCH_MIN = 8;

export function TagMultiSelect({ tags, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const showSearch = tags.length >= SEARCH_MIN;

  const selected = useMemo(
    () => value.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as Tag[],
    [tags, value],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tags, q]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  function remove(id: string) {
    onChange(value.filter((x) => x !== id));
  }

  return (
    <div className="tag-multi" data-testid="tag-multi-select" ref={rootRef}>
      <div className="tag-multi-chips" data-testid="tag-multi-chips">
        {selected.length === 0 ? (
          <span className="muted small">Не выбраны</span>
        ) : (
          selected.map((t) => (
            <span key={t.id} className="tag-multi-chip-wrap">
              <TagPill name={t.name} color={t.color} />
              <button
                type="button"
                className="tag-multi-chip-remove"
                aria-label={`Убрать тег ${t.name}`}
                data-testid={`tag-multi-remove-${t.id}`}
                onClick={() => remove(t.id)}
              >
                <X size={14} aria-hidden />
              </button>
            </span>
          ))
        )}
      </div>
      <button
        type="button"
        className="secondary tag-multi-trigger"
        data-testid="tag-multi-trigger"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        Выбрать теги
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div
          id={listId}
          className="tag-multi-popover"
          data-testid="tag-multi-popover"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Теги"
        >
          {showSearch && (
            <label className="tag-multi-search">
              <Search size={16} aria-hidden />
              <input
                data-testid="tag-multi-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск тегов"
                autoComplete="off"
              />
            </label>
          )}
          <ul className="tag-multi-list">
            {filtered.length === 0 && (
              <li className="muted small" style={{ padding: "8px 12px" }}>
                Ничего не найдено
              </li>
            )}
            {filtered.map((t) => {
              const checked = value.includes(t.id);
              return (
                <li key={t.id}>
                  <label className="tag-multi-option">
                    <input
                      type="checkbox"
                      role="option"
                      aria-selected={checked}
                      data-testid={`tag-multi-option-${t.id}`}
                      checked={checked}
                      onChange={() => toggle(t.id)}
                    />
                    <span className="tag-swatch tiny" style={{ background: t.color }} />
                    {t.name}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
