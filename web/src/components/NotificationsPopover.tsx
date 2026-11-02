import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { NoteIllustration } from "./NoteIllustration";
import { NoteLink } from "./NoteLink";

type Props = {
  open: boolean;
  onClose: () => void;
  onMarkSeen: (id: string) => void;
  soundPlaying?: boolean;
  onMuteSound?: () => void;
};

export function NotificationsPopover({
  open,
  onClose,
  onMarkSeen,
  soundPlaying = false,
  onMuteSound,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const unseen = useQuery({
    queryKey: ["notifications", "unseen"],
    queryFn: () => api.listNotifications(true),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    function onPointer(e: PointerEvent) {
      const el = panelRef.current;
      const target = e.target as Node | null;
      if (!el || !target) return;
      if (el.contains(target)) return;
      const bell = (target as HTMLElement).closest?.('[data-testid="notif-bell"]');
      if (bell) return;
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (!open) return null;

  const items = unseen.data ?? [];

  async function markAll() {
    await Promise.all(items.map((n) => onMarkSeen(n.id)));
  }

  return (
    <div
      ref={panelRef}
      className="notif-popover card"
      data-testid="notif-inbox"
      role="dialog"
      aria-label="Уведомления"
    >
      <div className="notif-popover-head">
        <h4>Уведомления</h4>
        <div className="notif-popover-actions">
          {soundPlaying && onMuteSound ? (
            <button
              type="button"
              className="secondary"
              data-testid="mute-alarm-inbox"
              onClick={onMuteSound}
            >
              Выключить звук
            </button>
          ) : null}
          <button
            type="button"
            className="secondary"
            data-testid="notif-mark-all"
            onClick={() => void markAll()}
            disabled={items.length === 0}
          >
            Прочитано
          </button>
        </div>
      </div>
      {items.length === 0 && <p className="muted small" style={{ padding: "12px 18px" }}>Пусто</p>}
      <ul className="notif-popover-list">
        {items.map((n) => (
          <li key={n.id} className="notif-popover-row">
            <NoteIllustration title={n.title} body={n.body} size={44} />
            {n.note_id ? (
              <NoteLink
                noteId={n.note_id}
                className="note-main linkish"
                onClick={() => {
                  void onMarkSeen(n.id);
                  onClose();
                }}
              >
                <strong className="list-note-title">
                  <span className="list-note-title-text">{n.title}</span>
                </strong>
                <span className="muted small">{n.body}</span>
              </NoteLink>
            ) : (
              <button
                type="button"
                className="note-main linkish"
                onClick={() => {
                  void onMarkSeen(n.id);
                  onClose();
                }}
              >
                <strong className="list-note-title">
                  <span className="list-note-title-text">{n.title}</span>
                </strong>
                <span className="muted small">{n.body}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
