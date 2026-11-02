import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  Clock3,
  List,
  MoreHorizontal,
  Phone,
  Settings2,
  Tags,
  Trash2,
  SquarePlay,
} from "lucide-react";

const MORE_PATHS = ["/settings", "/tags", "/capture/call", "/capture/video"];

type Props = {
  unseenCount?: number;
  onOpenInbox?: () => void;
};

export function MobileNav({ unseenCount = 0, onOpenInbox }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const moreActive = MORE_PATHS.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function onDoc(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  function go(path: string) {
    setMoreOpen(false);
    navigate(path);
  }

  return (
    <nav className="mobile-nav" aria-label="Основная навигация">
      <NavLink to="/upcoming" className={({ isActive }) => (isActive ? "on" : undefined)}>
        <Clock3 aria-hidden="true" />
        Ближайшее
      </NavLink>
      <NavLink to="/calendar" className={({ isActive }) => (isActive ? "on" : undefined)}>
        <CalendarDays aria-hidden="true" />
        Календарь
      </NavLink>
      <NavLink to="/list" className={({ isActive }) => (isActive ? "on" : undefined)}>
        <List aria-hidden="true" />
        Список
      </NavLink>
      <NavLink to="/trash" className={({ isActive }) => (isActive ? "on" : undefined)}>
        <Trash2 aria-hidden="true" />
        Корзина
      </NavLink>
      <div className="mobile-nav-more" ref={moreRef}>
        <button
          type="button"
          className={moreActive || moreOpen ? "on" : undefined}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="Ещё"
          data-testid="mobile-nav-more"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <MoreHorizontal aria-hidden="true" />
          Ещё
          {unseenCount > 0 ? (
            <span className="mobile-nav-badge" aria-label={`${unseenCount} непрочитанных`}>
              {unseenCount > 9 ? "9+" : unseenCount}
            </span>
          ) : null}
        </button>
        {moreOpen ? (
          <ul className="mobile-nav-more-menu" role="menu" data-testid="mobile-nav-more-menu">
            <li role="none">
              <button
                type="button"
                role="menuitem"
                data-testid="mobile-nav-notifications"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenInbox?.();
                }}
              >
                <Bell aria-hidden="true" size={18} />
                Уведомления
                {unseenCount > 0 ? (
                  <span className="mobile-nav-menu-count">{unseenCount}</span>
                ) : null}
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" onClick={() => go("/tags")}>
                <Tags aria-hidden="true" size={18} />
                Теги
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" onClick={() => go("/capture/call")}>
                <Phone aria-hidden="true" size={18} />
                Звонок
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" onClick={() => go("/capture/video")}>
                <SquarePlay aria-hidden="true" size={18} />
                Видео
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" onClick={() => go("/settings")}>
                <Settings2 aria-hidden="true" size={18} />
                Настройки
              </button>
            </li>
          </ul>
        ) : null}
      </div>
    </nav>
  );
}
