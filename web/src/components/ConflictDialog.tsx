import { createPortal } from "react-dom";
import { Note } from "../api";

type Props = {
  draft: { title: string; body: string; startsLocal: string };
  server: Note;
  timeZone: string;
  formatStarts: (iso: string) => string;
  onMine: () => void;
  onTheirs: () => void;
  onClose: () => void;
};

export function ConflictDialog({
  draft,
  server,
  formatStarts,
  onMine,
  onTheirs,
  onClose,
}: Props) {
  return createPortal(
    <div className="modal-backdrop" data-testid="conflict-dialog" role="dialog" aria-modal="true">
      <div className="modal card">
        <h3>Конфликт версий</h3>
        <p className="muted small">
          Заметка изменена на другом устройстве. Черновик не сброшен — выберите действие.
        </p>
        <div className="conflict-compare">
          <div>
            <h4>Моя версия</h4>
            <p>
              <strong>{draft.title || "Без названия"}</strong>
            </p>
            <p className="small muted">{draft.body || "—"}</p>
            <p className="small muted">{draft.startsLocal}</p>
          </div>
          <div>
            <h4>Серверная</h4>
            <p>
              <strong>{server.title || "Без названия"}</strong>
            </p>
            <p className="small muted">{server.body || "—"}</p>
            <p className="small muted">{formatStarts(server.starts_at)}</p>
            <p className="small muted">version {server.version}</p>
          </div>
        </div>
        <div className="row-actions">
          <button type="button" data-testid="conflict-mine" onClick={onMine}>
            Моя версия поверх
          </button>
          <button type="button" className="secondary" data-testid="conflict-theirs" onClick={onTheirs}>
            Принять серверную
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Сравнить / позже
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
