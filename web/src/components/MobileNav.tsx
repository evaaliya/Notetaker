import { NavLink } from "react-router-dom";
import { CalendarDays, Clock3, List, MoreHorizontal, Trash2 } from "lucide-react";

export function MobileNav() {
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
      <NavLink to="/settings" className={({ isActive }) => (isActive ? "on" : undefined)}>
        <MoreHorizontal aria-hidden="true" />
        Ещё
      </NavLink>
    </nav>
  );
}
