import type { CSSProperties } from "react";
import { tagColors } from "../lib/tagColors";

type Props = {
  name: string;
  color: string;
  className?: string;
};

export function TagPill({ name, color, className }: Props) {
  const { fill, ink } = tagColors(color);
  return (
    <span
      className={["tag-pill", className].filter(Boolean).join(" ")}
      style={{ "--tag-bg": fill, "--tag-fg": ink } as CSSProperties}
      data-testid="tag-pill"
      title={name}
    >
      {name}
    </span>
  );
}
