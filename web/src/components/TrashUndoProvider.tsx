import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import {
  dismissTrashUndo,
  getTrashUndoItems,
  pushTrashUndo as pushTrashUndoStore,
  subscribeTrashUndo,
  type TrashUndoItem,
} from "../lib/trashUndo";

export function pushTrashUndo(noteId: string, title: string): void {
  pushTrashUndoStore(noteId, title);
}

/** Re-export for callers that prefer a named hook-style API. */
export function useTrashUndo() {
  return { pushTrashUndo };
}

export function TrashUndoProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<TrashUndoItem[]>(() => getTrashUndoItems());

  useEffect(() => subscribeTrashUndo(() => setItems(getTrashUndoItems())), []);

  async function undoTrash(item: TrashUndoItem) {
    dismissTrashUndo(item.id);
    try {
      await api.restoreNote(item.noteId);
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
    } catch {
      /* restore failed — toast already dismissed */
    }
  }

  return (
    <>
      {children}
      {items.length > 0 ? (
        <div
          className="toast-stack trash-undo-stack"
          data-testid="trash-undo-toast"
          aria-live="polite"
        >
          {items.map((item) => (
            <div key={item.id} className="toast" data-trash-undo-id={item.id}>
              <div>
                <strong>Заметка перемещена в корзину</strong>
                <p className="small muted">{item.title}</p>
              </div>
              <button
                type="button"
                className="secondary"
                data-testid="trash-undo"
                onClick={() => void undoTrash(item)}
              >
                Отменить
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
