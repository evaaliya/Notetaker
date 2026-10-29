import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { NoteIllustration } from "./NoteIllustration";

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
  const unseen = useQuery({
    queryKey: ["notifications", "unseen"],
    queryFn: () => api.listNotifications(true),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointer(e: PointerEvent) {
      const el = panelRef.current;
      const target = e.target as Node | null;
      if (!el || !target) return;
      if (el.contains(target)) return;
      const bell = (target as HTMLElement).closest?.('[data-testid="notif-bell"]');
      if (bell) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onClose]);

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
            <div className="note-main">
              <strong>{n.title}</strong>
              <span className="muted small">{n.body}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
