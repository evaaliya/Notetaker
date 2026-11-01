import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  label: string;
  summary?: string;
  icon?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  testId: string;
};

/**
 * Compact toolbar control + popover for note meta (D-093).
 * Children stay mounted when closed so form values are preserved.
 */
export function EditorMetaDisclosure({
  label,
  summary,
  icon,
  open,
  onOpenChange,
  children,
  testId,
}: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onOpenChange]);

  const summaryText = summary?.trim() ?? "";
  const showSummary = summaryText.length > 0 && summaryText !== "нет" && summaryText !== "без повтора";

  return (
    <div
      className={`editor-tool${open ? " is-open" : ""}`}
      data-testid={testId}
      data-open={open ? "1" : "0"}
      ref={rootRef}
    >
      <button
        type="button"
        className="editor-tool-btn"
        data-testid={`${testId}-trigger`}
        aria-expanded={open}
        aria-controls={panelId}
        title={showSummary ? `${label}: ${summaryText}` : label}
        onClick={() => onOpenChange(!open)}
      >
        {icon ? (
          <span className="editor-tool-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="editor-tool-label">{label}</span>
        {showSummary ? (
          <span className="editor-tool-summary muted">{summaryText}</span>
        ) : null}
      </button>
      <div
        id={panelId}
        className="editor-tool-popover"
        data-testid={`${testId}-panel`}
        hidden={!open}
        role="dialog"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}
