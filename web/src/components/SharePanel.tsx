import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Note } from "../api";
import { invalidateNoteCaches } from "../lib/queryInvalidation";

type Props = { note: Note };

export function SharePanel({ note }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Nested <form> inside note editor is invalid HTML and breaks submit — use div + button.
  const isOwner = note.role === "owner" || note.role == null;
  const isEditor = note.role === "editor";

  const members = useQuery({
    queryKey: ["members", note.id],
    queryFn: () => api.listMembers(note.id),
    enabled: isOwner && Boolean(note.id),
  });

  const add = useMutation({
    mutationFn: (value: string) => api.addMember(note.id, value),
    onSuccess: () => {
      setLogin("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["members", note.id] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(note.id, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", note.id] }),
  });

  const leave = useMutation({
    mutationFn: () => api.leaveNote(note.id),
    onSuccess: () => {
      invalidateNoteCaches(qc);
      navigate("/list");
    },
  });

  function submitShare() {
    const value = login.trim();
    if (!value) {
      setError("Укажите логин пользователя");
      return;
    }
    setError(null);
    add.mutate(value);
  }

  if (isEditor) {
    return (
      <div className="share-panel" data-testid="share-panel">
        <p className="muted small" data-testid="shared-note-badge">
          Общая · владелец: {note.owner_login}
        </p>
        <button
          type="button"
          className="secondary"
          data-testid="leave-note"
          onClick={() => leave.mutate()}
          disabled={leave.isPending}
        >
          Покинуть
        </button>
      </div>
    );
  }

  if (!isOwner) return null;

  return (
    <div className="share-panel" data-testid="share-panel">
      <h3>Поделиться</h3>
      <div className="share-form">
        <label>
          Логин участника
          <input
            data-testid="share-login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitShare();
              }
            }}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          data-testid="share-add"
          disabled={add.isPending}
          onClick={() => submitShare()}
        >
          Добавить
        </button>
      </div>
      {error && (
        <p className="error" data-testid="share-error">
          {error}
        </p>
      )}
      <ul className="share-members" data-testid="share-members">
        {(members.data ?? []).map((m) => (
          <li key={m.user_id}>
            <span>{m.login}</span>
            <button
              type="button"
              className="link"
              data-testid={`share-remove-${m.login}`}
              onClick={() => remove.mutate(m.user_id)}
            >
              Удалить
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
