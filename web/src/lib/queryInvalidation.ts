import { QueryClient } from "@tanstack/react-query";

/** Canonical note-related Query keys — keep list/calendar/upcoming/note in sync (M16). */
export function invalidateNoteCaches(
  qc: QueryClient,
  opts?: { noteId?: string; includeTrash?: boolean },
): void {
  qc.invalidateQueries({ queryKey: ["notes"] });
  qc.invalidateQueries({ queryKey: ["calendar"] });
  qc.invalidateQueries({ queryKey: ["upcoming"] });
  if (opts?.includeTrash !== false) {
    qc.invalidateQueries({ queryKey: ["trash"] });
  }
  if (opts?.noteId) {
    qc.invalidateQueries({ queryKey: ["note", opts.noteId] });
  }
}
