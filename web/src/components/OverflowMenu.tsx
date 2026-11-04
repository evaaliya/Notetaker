import {
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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

type MenuPos = { top: number; left: number };

function clampMenuPos(
  trigger: DOMRect,
  menu: DOMRect,
): MenuPos {
  const gap = 4;
  const pad = 8;
  let top = trigger.bottom + gap;
  let left = trigger.right - menu.width;

  if (top + menu.height > window.innerHeight - pad) {
    top = Math.max(pad, trigger.top - menu.height - gap);
  }
  // Right-align to trigger so menu sits over actions, not note title.
  if (left < pad) left = pad;
  if (left + menu.width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - pad - menu.width);
  }
  return { top, left };
}

/** Compact menu for secondary actions. Items stay fully reachable — nothing is removed. */
export function OverflowMenu({
  label = "Ещё",
  items,
  className,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos>({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const reposition = useCallback(() => {
    if (!rootRef.current || !menuRef.current) return;
    setPos(
      clampMenuPos(
        rootRef.current.getBoundingClientRect(),
        menuRef.current.getBoundingClientRect(),
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, items.length, reposition]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

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
      {open
        ? createPortal(
            <ul
              id={menuId}
              ref={menuRef}
              className="overflow-menu-list overflow-menu-list-portal"
              role="menu"
              data-testid="overflow-menu-list"
              style={{ top: pos.top, left: pos.left }}
            >
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
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
