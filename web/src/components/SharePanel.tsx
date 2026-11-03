import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, Note, NoteMember } from "../api";
import { ContactPill } from "./ContactPill";
import { ParticipantStack } from "./ParticipantStack";
import {
  listShareContacts,
  rememberShareContact,
  rememberShareContacts,
} from "../lib/shareContacts";

type Props = { note: Note };

/** Group note: owner + editors; stack UI when more than two people (D-114). */
const STACK_FROM = 3;

function editorsOnly(people: NoteMember[]): NoteMember[] {
  return people.filter((m) => m.role === "editor");
}

export function SharePanel({ note }: Props) {
  const qc = useQueryClient();
  const [login, setLogin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [contactsTick, setContactsTick] = useState(0);

  // Nested <form> inside note editor is invalid HTML and breaks submit — use div + button.
  const isOwner = note.role === "owner" || note.role == null;
  const isEditor = note.role === "editor";
  const canListMembers = (isOwner || isEditor) && Boolean(note.id);

  const members = useQuery({
    queryKey: ["members", note.id],
    queryFn: () => api.listMembers(note.id),
    enabled: canListMembers,
  });

  const people = members.data ?? [];
  const editors = useMemo(() => editorsOnly(people), [people]);
  const useStack = people.length >= STACK_FROM;

  useEffect(() => {
    if (!editors.length) return;
    rememberShareContacts(editors.map((m) => ({ user_id: m.user_id, login: m.login })));
    setContactsTick((n) => n + 1);
  }, [editors]);

  const memberIds = useMemo(() => new Set(editors.map((m) => m.user_id)), [editors]);

  const suggestions = useMemo(() => {
    void contactsTick;
    return listShareContacts().filter((c) => !memberIds.has(c.user_id));
  }, [memberIds, contactsTick, members.dataUpdatedAt]);

  const add = useMutation({
    mutationFn: (value: string) => api.addMember(note.id, value),
    onSuccess: (m) => {
      setLogin("");
      setError(null);
      setAdding(false);
      rememberShareContact({ user_id: m.user_id, login: m.login });
      setContactsTick((n) => n + 1);
      qc.invalidateQueries({ queryKey: ["members", note.id] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(note.id, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", note.id] }),
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

  // Member: see everyone; stack when ≥3 people; else light owner pill.
  if (isEditor) {
    return (
      <div className="share-member-block" data-testid="share-panel">
        <div className="share-owner-above" data-testid="shared-note-badge">
          <span className="share-label muted small">Общая</span>
          {useStack ? (
            <ParticipantStack people={people} />
          ) : note.owner_login ? (
            <ContactPill login={note.owner_login} variant="owner" testId="share-owner-pill" />
          ) : null}
        </div>
      </div>
    );
  }

  if (!isOwner) return null;

  return (
    <div className="share-panel share-panel-compact" data-testid="share-panel">
      <div className="share-label muted small">Поделиться</div>
      <div className="share-pill-row" data-testid="share-members">
        {useStack ? (
          <ParticipantStack people={people} />
        ) : (
          editors.map((m) => (
            <ContactPill
              key={m.user_id}
              login={m.login}
              variant="member"
              disabled={remove.isPending}
              onRemove={() => remove.mutate(m.user_id)}
            />
          ))
        )}
        <button
          type="button"
          className="contact-pill-add"
          data-testid="share-add-toggle"
          aria-label="Добавить участника"
          aria-expanded={adding}
          onClick={() => {
            setAdding((v) => !v);
            setError(null);
          }}
        >
          <Plus size={16} strokeWidth={2.5} aria-hidden />
        </button>
      </div>

      {useStack && editors.length > 0 && (
        <ul className="share-stack-manage" data-testid="share-members-manage">
          {editors.map((m) => (
            <li key={m.user_id}>
              <span>{m.login}</span>
              <button
                type="button"
                className="link"
                data-testid={`share-remove-${m.login}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(m.user_id)}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="share-form">
          <label className="share-form-field">
            <span className="visually-hidden">Логин участника</span>
            <input
              data-testid="share-login"
              value={login}
              placeholder="Логин или email"
              onChange={(e) => setLogin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitShare();
                }
                if (e.key === "Escape") {
                  setAdding(false);
                  setError(null);
                }
              }}
              autoComplete="off"
              autoFocus
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
      )}

      {suggestions.length > 0 && (
        <div className="share-suggestions" data-testid="share-suggestions">
          <div className="share-label muted small">Недавние</div>
          <div className="share-pill-row">
            {suggestions.map((c) => (
              <ContactPill
                key={c.user_id}
                login={c.login}
                variant="suggestion"
                disabled={add.isPending}
                testId={`share-suggest-${c.login}`}
                onAdd={() => add.mutate(c.login)}
              />
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="error" data-testid="share-error">
          {error}
        </p>
      )}
    </div>
  );
}
