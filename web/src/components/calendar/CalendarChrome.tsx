import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalView } from "../../lib/calendar/groupByLocalDay";

type Props = {
  title: string;
  view: CalView;
  isMobile: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalView) => void;
};

const VIEWS: { id: CalView; label: string }[] = [
  { id: "day", label: "День" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
];

export function CalendarChrome({
  title,
  view,
  isMobile,
  onPrev,
  onNext,
  onToday,
  onViewChange,
}: Props) {
  const nav = (
    <div className={isMobile ? "cal-mobile-nav" : "cal-chrome-nav"}>
      <button
        type="button"
        className={`secondary ${isMobile ? "cal-mobile-nav-btn" : "cal-chrome-nav-btn"}`}
        aria-label="Предыдущий период"
        data-testid={isMobile ? "cal-mobile-prev" : "cal-prev"}
        onClick={onPrev}
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <div
        className={isMobile ? "cal-mobile-title" : "cal-chrome-title"}
        data-testid={isMobile ? "cal-mobile-title" : "cal-title"}
      >
        {title || "…"}
      </div>
      <button
        type="button"
        className={`secondary ${isMobile ? "cal-mobile-nav-btn" : "cal-chrome-nav-btn"}`}
        aria-label="Следующий период"
        data-testid={isMobile ? "cal-mobile-next" : "cal-next"}
        onClick={onNext}
      >
        <ChevronRight size={20} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`secondary ${isMobile ? "cal-mobile-today" : "cal-chrome-today"}`}
        data-testid={isMobile ? "cal-mobile-today" : "cal-today"}
        onClick={onToday}
      >
        Сегодня
      </button>
    </div>
  );

  const tabs = (
    <div
      className={isMobile ? "cal-mobile-views" : "cal-chrome-views"}
      role="tablist"
      aria-label="Режим календаря"
      data-testid={isMobile ? "cal-mobile-views" : "cal-views"}
    >
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          className={view === id ? "on" : undefined}
          data-testid={
            isMobile
              ? id === "day"
                ? "cal-mobile-view-timeGridDay"
                : id === "week"
                  ? "cal-mobile-view-timeGridWeek"
                  : "cal-mobile-view-dayGridMonth"
              : `cal-view-${id}`
          }
          onClick={() => onViewChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <div className="cal-mobile-chrome" data-testid="cal-mobile-chrome">
        {nav}
        {tabs}
      </div>
    );
  }

  return (
    <div className="cal-desktop-chrome" data-testid="cal-desktop-chrome">
      {nav}
      {tabs}
    </div>
  );
}
