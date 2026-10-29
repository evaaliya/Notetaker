/** Derive fill + readable ink from a base tag `#RRGGBB` (FRONTEND §3). */

export type TagColorPair = {
  fill: string;
  ink: string;
};

const NEUTRAL: TagColorPair = {
  fill: "#E8EEF0",
  ink: "#5B6773",
};

export function tagColors(hex: string | null | undefined): TagColorPair {
  const rgb = parseHex(hex);
  if (!rgb) return { ...NEUTRAL };

  const fill = mixWithWhite(rgb, 0.88);
  let ink = { ...rgb };
  // Darken until contrast vs fill is ≥ 4.5:1 (WCAG AA for normal text).
  for (let i = 0; i < 40; i++) {
    if (contrastRatio(ink, fill) >= 4.5) break;
    ink = darken(ink, 0.08);
  }
  if (contrastRatio(ink, fill) < 4.5) {
    ink = { r: 43, g: 38, b: 32 }; // --ink fallback
  }
  return { fill: toHex(fill), ink: toHex(ink) };
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string | null | undefined): Rgb | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixWithWhite(c: Rgb, whiteAmount: number): Rgb {
  const t = whiteAmount;
  return {
    r: Math.round(c.r + (255 - c.r) * t),
    g: Math.round(c.g + (255 - c.g) * t),
    b: Math.round(c.b + (255 - c.b) * t),
  };
}

function darken(c: Rgb, amount: number): Rgb {
  const f = 1 - amount;
  return {
    r: Math.max(0, Math.round(c.r * f)),
    g: Math.max(0, Math.round(c.g * f)),
    b: Math.max(0, Math.round(c.b * f)),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
