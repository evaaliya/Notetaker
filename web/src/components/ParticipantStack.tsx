import { contactInitials } from "../lib/shareContacts";

export type StackPerson = {
  user_id: string;
  login: string;
  role?: "owner" | "editor";
};

const MAX_VISIBLE = 10;

type Props = {
  people: StackPerson[];
  /** Max face circles before +N (D-114). */
  maxVisible?: number;
  testId?: string;
};

/**
 * Overlapping avatar circles (reference stack). Initials stand in for photos.
 */
export function ParticipantStack({
  people,
  maxVisible = MAX_VISIBLE,
  testId = "participant-stack",
}: Props) {
  if (people.length === 0) return null;
  const visible = people.slice(0, maxVisible);
  const more = people.length - visible.length;

  return (
    <div
      className="participant-stack"
      data-testid={testId}
      role="list"
      aria-label={`Участники: ${people.map((p) => p.login).join(", ")}`}
    >
      {visible.map((p, i) => (
        <span
          key={p.user_id}
          className="participant-stack-avatar"
          role="listitem"
          data-testid="participant-stack-avatar"
          data-login={p.login}
          title={p.role === "owner" ? `Владелец: ${p.login}` : p.login}
          style={{ zIndex: visible.length - i }}
        >
          {contactInitials(p.login)}
        </span>
      ))}
      {more > 0 ? (
        <span
          className="participant-stack-more"
          data-testid="participant-stack-more"
          title={`Ещё ${more}`}
          style={{ zIndex: 0 }}
        >
          +{more}
        </span>
      ) : null}
    </div>
  );
}
