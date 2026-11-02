import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  Clock3,
  List,
  PanelLeft,
  PanelLeftClose,
  Phone,
  Settings2,
  Tags,
  Trash2,
  SquarePlay,
} from "lucide-react";
import logoNt from "../assets/logo-nt.jpg";
import { api } from "../api";
import { TagPill } from "./TagPill";

type Props = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  unseenCount: number;
  inboxOpen: boolean;
  onToggleInbox: () => void;
  userEmail: string;
  onLogout: () => void;
  logoutBusy: boolean;
  bellShake?: boolean;
  soundPlaying?: boolean;
};

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  unseenCount,
  inboxOpen,
  onToggleInbox,
  userEmail,
  onLogout,
  logoutBusy,
  bellShake = false,
  soundPlaying = false,
}: Props) {
  const navigate = useNavigate();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const trash = useQuery({ queryKey: ["trash"], queryFn: api.trash });
  const [avatarMenu, setAvatarMenu] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  const trashCount = trash.data?.length ?? 0;

  useEffect(() => {
    if (!avatarMenu) return;
    function onDoc(e: MouseEvent) {
      if (!avatarRef.current?.contains(e.target as Node)) setAvatarMenu(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAvatarMenu(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [avatarMenu]);

  return (
    <aside
      className={`app-sidebar${collapsed ? " is-collapsed" : ""}`}
      aria-label="Навигация"
      data-testid="app-sidebar"
      data-collapsed={collapsed ? "1" : "0"}
    >
      <div className="side-top">
        <button
          type="button"
          className="side-collapse-toggle"
          data-testid="sidebar-toggle"
          aria-label={collapsed ? "Развернуть панель" : "Свернуть панель"}
          title={collapsed ? "Развернуть панель" : "Свернуть панель"}
          aria-pressed={collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <PanelLeft aria-hidden="true" />
          ) : (
            <PanelLeftClose aria-hidden="true" />
          )}
        </button>
        {!collapsed && (
          <div className="brand">
            <img className="brand-mark" src={logoNt} alt="" width={32} height={32} />
            <span className="brand-name">Notetaker</span>
          </div>
        )}
        {collapsed && (
          <img className="brand-mark side-brand-mini" src={logoNt} alt="" width={32} height={32} />
        )}
      </div>

      <nav className="side-nav">
        <NavLink
          to="/upcoming"
          className={({ isActive }) => navClass(isActive)}
          aria-label="Ближайшее"
          title="Ближайшее"
        >
          <Clock3 aria-hidden="true" />
          {!collapsed && <span>Ближайшее</span>}
        </NavLink>
        <NavLink
          to="/calendar"
          className={({ isActive }) => navClass(isActive)}
          aria-label="Календарь"
          title="Календарь"
        >
          <CalendarDays aria-hidden="true" />
          {!collapsed && <span>Календарь</span>}
        </NavLink>
        <NavLink
          to="/list"
          className={({ isActive }) => navClass(isActive)}
          aria-label="Список"
          title="Список"
        >
          <List aria-hidden="true" />
          {!collapsed && <span>Список</span>}
        </NavLink>
        <NavLink
          to="/capture/call"
          className={({ isActive }) => navClass(isActive)}
          aria-label="Звонок"
          title="Звонок"
          data-testid="nav-call"
        >
          <Phone aria-hidden="true" />
          {!collapsed && <span>Звонок</span>}
        </NavLink>
        <NavLink
          to="/capture/video"
          className={({ isActive }) => navClass(isActive)}
          aria-label="Видео"
          title="Видео"
          data-testid="nav-video"
        >
          <SquarePlay aria-hidden="true" />
          {!collapsed && <span>Видео</span>}
        </NavLink>
        <NavLink
          to="/trash"
          className={({ isActive }) => navClass(isActive)}
          aria-label="Корзина"
          title="Корзина"
        >
          <Trash2 aria-hidden="true" />
          {!collapsed && (
            <>
              <span>Корзина</span>
              {trashCount > 0 && <span className="nav-count">{trashCount}</span>}
            </>
          )}
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) => navClass(isActive)}
          aria-label="Настройки"
          title="Настройки"
        >
          <Settings2 aria-hidden="true" />
          {!collapsed && <span>Настройки</span>}
        </NavLink>
      </nav>

      {!collapsed && (
        <>
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
                <p
                  className="muted small"
                  style={{ padding: "0 var(--space-4)", color: "var(--sidebar-muted)" }}
                >
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
        </>
      )}

      {collapsed && (
        <button
          type="button"
          className="side-nav-link accent-link side-tags-icon"
          aria-label="Управлять тегами"
          title="Управлять тегами"
          onClick={() => navigate("/tags")}
        >
          <Tags aria-hidden="true" />
        </button>
      )}

      <div className="side-footer">
        <button
          type="button"
          className="side-notif"
          data-testid="notif-bell"
          aria-label="Уведомления"
          title="Уведомления"
          aria-expanded={inboxOpen}
          onClick={onToggleInbox}
        >
          <span className={`bell-icon${bellShake ? " shake" : ""}`}>
            <Bell aria-hidden="true" />
          </span>
          {!collapsed && (
            <span className="side-notif-label">
              Уведомления
              {soundPlaying ? (
                <span className="alarm-live" data-testid="alarm-playing">
                  Звучит сигнал
                </span>
              ) : null}
            </span>
          )}
          {collapsed && soundPlaying ? (
            <span className="alarm-live alarm-live-collapsed" data-testid="alarm-playing">
              Звучит сигнал
            </span>
          ) : null}
          {unseenCount > 0 && <span className="notif-badge">{unseenCount}</span>}
        </button>
        <div className="side-user" data-testid="side-user" ref={avatarRef}>
          {collapsed ? (
            <>
              <button
                type="button"
                className="side-user-avatar-btn"
                aria-label="Меню пользователя"
                title={userEmail}
                aria-expanded={avatarMenu}
                data-testid="side-avatar-menu"
                onClick={() => setAvatarMenu((v) => !v)}
              >
                <span className="side-user-avatar" aria-hidden="true" />
              </button>
              {avatarMenu && (
                <div className="side-avatar-menu" role="menu">
                  <div className="side-avatar-email" title={userEmail}>
                    {userEmail}
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="secondary"
                    onClick={onLogout}
                    disabled={logoutBusy}
                  >
                    Выйти
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <span className="side-user-avatar" aria-hidden="true" />
              <span className="side-user-email" title={userEmail}>
                {userEmail}
              </span>
              <button type="button" className="secondary" onClick={onLogout} disabled={logoutBusy}>
                Выйти
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function navClass(isActive: boolean) {
  return isActive ? "side-nav-link on" : "side-nav-link";
}
