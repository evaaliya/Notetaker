import { expect, test } from "@playwright/test";
import { contrastRatio, tagColors } from "../src/lib/tagColors";
import { pickIllustration } from "../src/lib/pickIllustration";

function parseHex(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const PALETTE = [
  "#3E6FB0",
  "#6B4A9E",
  "#B07A1C",
  "#2F6B4B",
  "#B4402F",
  "#2E7F8F",
  "#8A4B6E",
  "#5B5348",
];

test("tagColors_contrast_ge_45", () => {
  for (const hex of PALETTE) {
    const { fill, ink } = tagColors(hex);
    const ratio = contrastRatio(parseHex(ink), parseHex(fill));
    expect(ratio, `${hex} → ${fill}/${ink}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("tagColors_tint_is_light", () => {
  for (const hex of PALETTE) {
    const { fill } = tagColors(hex);
    const { r, g, b } = parseHex(fill);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luma, fill).toBeGreaterThan(180);
  }
});

test("pickIllustration_keywords_ru_en", () => {
  expect(pickIllustration("Созвон с командой", "", null)).toBe("phone");
  expect(pickIllustration("Weekly call", "", null)).toBe("phone");
  expect(pickIllustration("Тренировка", "", null)).toBe("dumbbell");
  expect(pickIllustration("Оплатить аренду", "", null)).toBe("home");
  expect(pickIllustration("Купить подарок", "", null)).toBe("gift");
  expect(pickIllustration("Лекция по физике", "", null)).toBe("book");
  expect(pickIllustration("Визит к врачу", "", null)).toBe("medical");
  expect(pickIllustration("Оплата счёта", "", null)).toBe("wallet");
});

test("pickIllustration_falls_back_to_tag_then_default", () => {
  expect(pickIllustration("Заметка", "", "Учёба")).toBe("book");
  expect(pickIllustration("Заметка", "", "Дом")).toBe("home");
  expect(pickIllustration("Заметка", "", "Работа")).toBe("phone");
  expect(pickIllustration("Заметка", "", "Что-то")).toBe("note");
  expect(pickIllustration("", "", null)).toBe("note");
});
