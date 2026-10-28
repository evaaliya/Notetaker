import type { CSSProperties } from "react";
import {
  BookOpen,
  Dumbbell,
  Gift,
  Home,
  NotebookPen,
  Phone,
  Stethoscope,
  Wallet,
} from "lucide-react";
import { tagColors } from "../lib/tagColors";
import { IllustrationKey, pickIllustration } from "../lib/pickIllustration";

type Props = {
  title: string;
  body?: string;
  tagName?: string | null;
  tagColor?: string | null;
  size?: number;
  className?: string;
  shake?: boolean;
};

const ICONS: Record<IllustrationKey, typeof Phone> = {
  phone: Phone,
  dumbbell: Dumbbell,
  home: Home,
  gift: Gift,
  book: BookOpen,
  medical: Stethoscope,
  wallet: Wallet,
  note: NotebookPen,
};

export function NoteIllustration({
  title,
  body = "",
  tagName,
  tagColor,
  size = 44,
  className,
  shake = false,
}: Props) {
  const key = pickIllustration(title, body, tagName);
  const Icon = ICONS[key];
  const { fill, ink } = tagColors(tagColor);
  return (
    <div
      className={["note-illustration", shake ? "shake" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          width: size,
          height: size,
          "--tag-bg": fill,
          "--tag-fg": ink,
        } as CSSProperties
      }
      aria-hidden="true"
      data-illustration={key}
    >
      <Icon strokeWidth={1.5} />
    </div>
  );
}
