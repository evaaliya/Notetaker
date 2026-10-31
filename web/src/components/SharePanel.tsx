import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Note } from "../api";

type Props = { note: Note };

export function SharePanel({ note }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["upcoming"] });
      navigate("/list");
    },
  });

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

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = login.trim();
    if (!value) return;
    add.mutate(value);
  }

  return (
    <div className="share-panel" data-testid="share-panel">
      <h3>Поделиться</h3>
      <form className="share-form" onSubmit={onSubmit}>
        <label>
          Логин участника
          <input
            data-testid="share-login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button type="submit" data-testid="share-add" disabled={add.isPending}>
          Добавить
        </button>
      </form>
      {error && <p className="error">{error}</p>}
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
