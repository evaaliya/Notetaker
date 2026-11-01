import type { Tag } from "../api";
import { TagPill } from "./TagPill";

type Props = {
  tags: Tag[];
  value: string[];
  onChange: (ids: string[]) => void;
};

/**
 * Compact multi-select: coloured TagPill chips, click to toggle (D-093).
 * No search, no checkboxes, no separate “Выбрать теги” control — parent opens the popover.
 */
export function TagMultiSelect({ tags, value, onChange }: Props) {
  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  if (tags.length === 0) {
    return (
      <p className="muted small" data-testid="tag-multi-select">
        Нет тегов. Создайте их в разделе «Теги».
      </p>
    );
  }

  return (
    <div className="tag-multi" data-testid="tag-multi-select">
      <ul className="tag-multi-list" role="listbox" aria-multiselectable="true" aria-label="Теги">
        {tags.map((t) => {
          const selected = value.includes(t.id);
          return (
            <li key={t.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`tag-multi-option${selected ? " is-selected" : ""}`}
                data-testid={`tag-multi-option-${t.id}`}
                onClick={() => toggle(t.id)}
              >
                <TagPill name={t.name} color={t.color} />
              </button>
            </li>
          );
        })}
      </ul>
      {value.length > 0 ? (
        <div className="tag-multi-chips" data-testid="tag-multi-chips">
          {tags
            .filter((t) => value.includes(t.id))
            .map((t) => (
              <TagPill key={t.id} name={t.name} color={t.color} />
            ))}
        </div>
      ) : (
        <div className="tag-multi-chips" data-testid="tag-multi-chips" hidden />
      )}
    </div>
  );
}
