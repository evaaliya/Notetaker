import type { ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

type Props = Omit<LinkProps, "to"> & {
  noteId: string;
  className?: string;
  children: ReactNode;
};

/** Navigates to the note editor page — use for list-like surfaces (D-087). */
export function NoteLink({ noteId, className, children, ...rest }: Props) {
  return (
    <Link
      to={`/notes/${noteId}`}
      className={className}
      data-testid="note-link"
      data-note-id={noteId}
      {...rest}
    >
      {children}
    </Link>
  );
}
