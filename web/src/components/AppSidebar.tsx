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
import logoNt from "../assets/logo-nt.jpg";
import { api } from "../api";
import { TagPill } from "./TagPill";

type Props = {
  unseenCount: number;
  inboxOpen: boolean;
  onToggleInbox: () => void;
  userEmail: string;
  onLogout: () => void;
  logoutBusy: boolean;
  bellShake?: boolean;
};

export function AppSidebar({
  unseenCount,
  inboxOpen,
  onToggleInbox,
  userEmail,
  onLogout,
  logoutBusy,
  bellShake = false,
}: Props) {
  const navigate = useNavigate();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const trash = useQuery({ queryKey: ["trash"], queryFn: api.trash });

  const trashCount = trash.data?.length ?? 0;

  return (
    <aside className="app-sidebar" aria-label="Навигация" data-testid="app-sidebar">
      <div className="brand">
        <img className="brand-mark" src={logoNt} alt="" width={32} height={32} />
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

      <div className="lab side-lab">Теги</div>
      <div className="side-tags-scroll">
        <div className="side-tags">
          {(tags.data ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              className="side-tag-row"
              onClick={() => navigate(`/list?tag=${encodeURIComponent(t.id)}`)}
            >
              <TagPill name={t.name} color={t.color} />
            </button>
          ))}
          {(tags.data ?? []).length === 0 && (
            <p className="muted small" style={{ padding: "0 14px", color: "var(--sidebar-muted)" }}>
              Пока нет тегов
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        className="side-nav-link accent-link"
        onClick={() => navigate("/tags")}
      >
        Управлять тегами
      </button>

      <div className="side-footer">
        <button
          type="button"
          className="side-notif"
          data-testid="notif-bell"
          aria-label="Уведомления"
          aria-expanded={inboxOpen}
          onClick={onToggleInbox}
        >
          <span className={`bell-icon${bellShake ? " shake" : ""}`}>
            <Bell aria-hidden="true" />
          </span>
          Уведомления
          {unseenCount > 0 && <span className="notif-badge">{unseenCount}</span>}
        </button>
        <div className="side-user" data-testid="side-user">
          <span className="side-user-avatar" aria-hidden="true" />
          <span className="side-user-email" title={userEmail}>
            {userEmail}
          </span>
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
