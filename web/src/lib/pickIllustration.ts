/** Keyword / tag → illustration key (FRONTEND §4). No network, no models. */

export type IllustrationKey =
  | "phone"
  | "dumbbell"
  | "home"
  | "gift"
  | "book"
  | "medical"
  | "wallet"
  | "note";

type Rule = { key: IllustrationKey; words: string[] };

/** Ordered keyword table: first match in title+body wins. */
export const ILLUSTRATION_KEYWORD_RULES: Rule[] = [
  {
    key: "phone",
    words: ["созвон", "звонок", "call", "meeting", "митинг", "телефон", "phone"],
  },
  {
    key: "dumbbell",
    words: ["тренировк", "спорт", "зал", "workout", "gym", "fitness", "бег"],
  },
  {
    key: "home",
    words: ["аренд", "квартир", "дом", "home", "rent", "жиль"],
  },
  {
    key: "gift",
    words: ["подарок", "подарк", "день рождения", "др", "birthday", "gift", "праздник"],
  },
  {
    key: "book",
    words: ["лекци", "учёб", "учеб", "экзамен", "книг", "lecture", "study", "exam", "book"],
  },
  {
    key: "medical",
    words: ["врач", "лекарств", "доктор", "clinic", "doctor", "medicine", "аптек"],
  },
  {
    key: "wallet",
    words: ["оплат", "счёт", "счет", "платёж", "платеж", "bill", "pay", "invoice"],
  },
];

const TAG_NAME_MAP: { key: IllustrationKey; words: string[] }[] = [
  { key: "phone", words: ["работа", "work"] },
  { key: "book", words: ["учёба", "учеба", "study"] },
  { key: "home", words: ["дом", "home"] },
  { key: "medical", words: ["здоровье", "health"] },
  { key: "wallet", words: ["срочно", "urgent", "финансы", "money"] },
];

export function pickIllustration(
  title: string,
  body: string,
  tagName?: string | null,
): IllustrationKey {
  const hay = `${title ?? ""} ${body ?? ""}`.toLowerCase();
  for (const rule of ILLUSTRATION_KEYWORD_RULES) {
    if (rule.words.some((w) => hay.includes(w.toLowerCase()))) {
      return rule.key;
    }
  }
  const tag = (tagName ?? "").toLowerCase().trim();
  if (tag) {
    for (const rule of TAG_NAME_MAP) {
      if (rule.words.some((w) => tag === w || tag.includes(w))) {
        return rule.key;
      }
    }
  }
  return "note";
}
