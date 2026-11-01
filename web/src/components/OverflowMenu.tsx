import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export type OverflowItem = {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
};

type Props = {
  label?: string;
  items: OverflowItem[];
  /** Keep trigger ≥44px; do not shrink for compactness. */
  className?: string;
  children?: ReactNode;
};

/** Compact menu for secondary actions. Items stay fully reachable — nothing is removed. */
export function OverflowMenu({
  label = "Ещё",
  items,
  className,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`overflow-menu${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        type="button"
        className="secondary overflow-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {children ?? <MoreHorizontal aria-hidden="true" size={20} />}
        <span className="overflow-menu-trigger-text">{label}</span>
      </button>
      {open ? (
        <ul id={menuId} className="overflow-menu-list" role="menu">
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className={item.danger ? "danger-text" : undefined}
                data-testid={item.testId}
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect();
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
