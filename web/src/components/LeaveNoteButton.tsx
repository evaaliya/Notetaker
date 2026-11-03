import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { invalidateNoteCaches } from "../lib/queryInvalidation";

type Props = {
  noteId: string;
  className?: string;
};

/** Leave a shared note (member). Place near Save / Close (D-113). */
export function LeaveNoteButton({ noteId, className }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const leave = useMutation({
    mutationFn: () => api.leaveNote(noteId),
    onSuccess: () => {
      invalidateNoteCaches(qc);
      navigate("/list");
    },
  });

  return (
    <button
      type="button"
      className={className ?? "secondary share-leave-btn"}
      data-testid="leave-note"
      onClick={() => leave.mutate()}
      disabled={leave.isPending}
    >
      Покинуть
    </button>
  );
}
