import type { CSSProperties } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  Clock3,
  List,
  Settings2,
  Trash2,
} from "lucide-react";
import { api } from "../api";

type Props = {
  unseenCount: number;
  inboxOpen: boolean;
  onToggleInbox: () => void;
  onMarkSeen: (id: string) => void;
  userLogin: string;
  onLogout: () => void;
  logoutBusy: boolean;
};

export function AppSidebar({
  unseenCount,
  inboxOpen,
  onToggleInbox,
  onMarkSeen,
  userLogin,
  onLogout,
  logoutBusy,
}: Props) {
  const navigate = useNavigate();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const trash = useQuery({ queryKey: ["trash"], queryFn: api.trash });
  const unseen = useQuery({
    queryKey: ["notifications", "unseen"],
    queryFn: () => api.listNotifications(true),
  });

  const trashCount = trash.data?.length ?? 0;

  return (
    <aside className="app-sidebar" aria-label="Навигация">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Notetaker</span>
      </div>

      <nav className="side-nav">
        <NavLink to="/upcoming" className={({ isActive }) => navClass(isActive)}>
          <Clock3 aria-hidden="true" />
          Ближайшее
        </NavLink>
        <NavLink to="/calendar" className={({ isActive }) => navClass(isActive)}>
          <CalendarDays aria-hidden="true" />
          Календарь
        </NavLink>
        <NavLink to="/list" className={({ isActive }) => navClass(isActive)}>
          <List aria-hidden="true" />
          Список
        </NavLink>
        <NavLink to="/trash" className={({ isActive }) => navClass(isActive)}>
          <Trash2 aria-hidden="true" />
          Корзина
          {trashCount > 0 && <span className="nav-count">{trashCount}</span>}
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => navClass(isActive)}>
          <Settings2 aria-hidden="true" />
          Настройки
        </NavLink>
      </nav>

      <div className="lab side-lab">Метки</div>
      <div className="side-tags">
        {(tags.data ?? []).map((t) => (
          <button
            key={t.id}
            type="button"
            className="side-tag-row"
            onClick={() => navigate(`/list?tag=${encodeURIComponent(t.id)}`)}
          >
            <span
              className="tag-pill side-tag-pill"
              style={
                {
                  "--tag-bg": mixTint(t.color),
                  "--tag-fg": t.color,
                } as CSSProperties
              }
            >
              {t.name}
            </span>
          </button>
        ))}
        {(tags.data ?? []).length === 0 && (
          <p className="muted small" style={{ padding: "0 14px" }}>
            Пока нет меток
          </p>
        )}
      </div>
      <button
        type="button"
        className="side-nav-link accent-link"
        onClick={() => navigate("/tags")}
      >
        Управлять метками
      </button>

      <div className="side-footer">
        <div className="bell-wrap side-bell">
          <button
            type="button"
            className="side-notif"
            data-testid="notif-bell"
            aria-label="Уведомления"
            onClick={onToggleInbox}
          >
            <span className="bell-icon">
              <Bell aria-hidden="true" />
            </span>
            Уведомления
            {unseenCount > 0 && <span className="notif-badge">{unseenCount}</span>}
          </button>
          {inboxOpen && (
            <div className="inbox card" data-testid="notif-inbox">
              <h4>Непрочитанные</h4>
              {unseenCount === 0 && <p className="muted small">Пусто</p>}
              <ul className="note-list">
                {(unseen.data ?? []).map((n) => (
                  <li key={n.id} className="note-row">
                    <div className="note-main">
                      <strong>{n.title}</strong>
                      <span className="muted small">{n.body}</span>
                    </div>
                    <button type="button" className="secondary" onClick={() => onMarkSeen(n.id)}>
                      Прочитано
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="side-user">
          <span className="muted small">{userLogin}</span>
          <button type="button" className="secondary" onClick={onLogout} disabled={logoutBusy}>
            Выйти
          </button>
        </div>
      </div>
    </aside>
  );
}

function navClass(isActive: boolean) {
  return isActive ? "side-nav-link on" : "side-nav-link";
}

/** Temporary tint until tagColors lands in M7.2. */
function mixTint(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#eee8df";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * 0.88);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
