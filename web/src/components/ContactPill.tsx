import type { ReactNode } from "react";
import { X } from "lucide-react";
import { contactInitials } from "../lib/shareContacts";

type Variant = "member" | "suggestion" | "owner";

type Props = {
  login: string;
  variant: Variant;
  /** Remove from note (member). */
  onRemove?: () => void;
  /** Add suggestion to note. */
  onAdd?: () => void;
  disabled?: boolean;
  testId?: string;
};

function PillBody({ login, trailing }: { login: string; trailing?: ReactNode }) {
  return (
    <>
      <span className="contact-pill-avatar" aria-hidden>
        {contactInitials(login)}
      </span>
      <span className="contact-pill-name">{login}</span>
      {trailing}
    </>
  );
}

/**
 * Compact assignee-style chip: avatar circle + login (reference layout, our tokens — D-113).
 * member/owner = filled; suggestion = outline (not yet on this note).
 */
export function ContactPill({
  login,
  variant,
  onRemove,
  onAdd,
  disabled,
  testId,
}: Props) {
  const className = `contact-pill contact-pill-${variant}`;
  const tid = testId ?? `contact-pill-${variant}`;

  if (variant === "suggestion" && onAdd) {
    return (
      <button
        type="button"
        className={className}
        data-testid={tid}
        data-login={login}
        disabled={disabled}
        onClick={onAdd}
        title={`Добавить ${login}`}
      >
        <PillBody login={login} />
      </button>
    );
  }

  return (
    <div className={className} data-testid={tid} data-login={login} title={login}>
      <PillBody
        login={login}
        trailing={
          variant === "member" && onRemove ? (
            <button
              type="button"
              className="contact-pill-remove"
              data-testid={`share-remove-${login}`}
              aria-label={`Удалить ${login}`}
              disabled={disabled}
              onClick={onRemove}
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          ) : null
        }
      />
    </div>
  );
}
