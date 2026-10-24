import { EditScope } from "../api";

type Props = {
  onChoose: (scope: EditScope) => void;
  onClose: () => void;
  /** If false, hide "all" (occurrence-only flows). */
  allowAll?: boolean;
};

export function EditScopeDialog({ onChoose, onClose, allowAll = false }: Props) {
  return (
    <div className="modal-backdrop" data-testid="edit-scope-dialog" role="dialog">
      <div className="modal card">
        <h3>Область правки</h3>
        <p className="muted small">Эта заметка — часть серии. Что изменить?</p>
        <div className="form-grid">
          <button type="button" data-testid="scope-this" onClick={() => onChoose("this")}>
            Только это вхождение
          </button>
          <button
            type="button"
            data-testid="scope-following"
            onClick={() => onChoose("following")}
          >
            Это и следующие
          </button>
          {allowAll && (
            <button type="button" data-testid="scope-all" onClick={() => onChoose("all")}>
              Всю серию
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
