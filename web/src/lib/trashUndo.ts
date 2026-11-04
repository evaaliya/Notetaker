import { safeRandomUUID } from "./safeRandomUUID";

/** Auto-hide window for «перемещена в корзину» undo toasts (M28). */
export const TRASH_UNDO_MS = 15_000;

export type TrashUndoItem = {
  id: string;
  noteId: string;
  title: string;
};

type Listener = () => void;

let items: TrashUndoItem[] = [];
const timers = new Map<string, number>();
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export function getTrashUndoItems(): TrashUndoItem[] {
  return items;
}

export function subscribeTrashUndo(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pushTrashUndo(noteId: string, title: string): string {
  const id = safeRandomUUID();
  const item: TrashUndoItem = {
    id,
    noteId,
    title: title || "Без названия",
  };
  items = [...items, item];
  const timer = window.setTimeout(() => {
    timers.delete(id);
    items = items.filter((x) => x.id !== id);
    emit();
  }, TRASH_UNDO_MS);
  timers.set(id, timer);
  emit();
  return id;
}

export function dismissTrashUndo(id: string): TrashUndoItem | null {
  const t = timers.get(id);
  if (t !== undefined) {
    window.clearTimeout(t);
    timers.delete(id);
  }
  const found = items.find((x) => x.id === id) ?? null;
  items = items.filter((x) => x.id !== id);
  emit();
  return found;
}
