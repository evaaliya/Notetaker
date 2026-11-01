import { useId, type ReactNode } from "react";

type Props = {
  label: string;
  summary: string;
  icon?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  testId: string;
};

/** Compact expandable meta block for the note editor (D-092). Values stay mounted when closed. */
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
  return (
    <div
      className={`editor-meta-item${open ? " is-open" : ""}`}
      data-testid={testId}
      data-open={open ? "1" : "0"}
    >
      <button
        type="button"
        className="editor-meta-trigger"
        data-testid={`${testId}-trigger`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        {icon ? (
          <span className="editor-meta-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="editor-meta-label">{label}</span>
        <span className="editor-meta-summary muted small">{summary}</span>
      </button>
      <div
        id={panelId}
        className="editor-meta-panel"
        data-testid={`${testId}-panel`}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
