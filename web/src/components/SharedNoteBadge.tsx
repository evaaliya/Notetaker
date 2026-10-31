import { Note } from "../api";

/** Marker for notes shared with the current user (M10). */
export function SharedNoteBadge({ note }: { note: Note }) {
  if (note.role !== "editor" || !note.owner_login) return null;
  return (
    <span className="muted small shared-note-badge" data-testid="shared-note-badge">
      Общая · владелец: {note.owner_login}
    </span>
  );
}
