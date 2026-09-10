/** WCAG relative luminance and contrast helpers for tenant colours. */

export function hexToRgb(hex: string): [number, number, number] | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function normalizeHex(raw: string): string {
  const v = (raw || "").trim();
  const m6 = v.match(/^#?([0-9a-fA-F]{6})$/);
  if (m6) return `#${m6[1]!.toLowerCase()}`;
  const m3 = v.match(/^#?([0-9a-fA-F]{3})$/);
  if (m3) {
    const [a, b, c] = m3[1]!;
    return `#${a}${a}${b}${b}${c}${c}`.toLowerCase();
  }
  return "";
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastFg(background: string, dark = "#061014", light = "#f7fafc") {
  const onDark = contrastRatio(background, dark);
  const onLight = contrastRatio(background, light);
  return onLight >= onDark ? light : dark;
}

export function mixHex(a: string, b: string, t: number) {
  const aa = hexToRgb(a);
  const bb = hexToRgb(b);
  if (!aa || !bb) return normalizeHex(a) || normalizeHex(b);
  const m = (i: number) => Math.round(aa[i]! + (bb[i]! - aa[i]!) * t);
  return `#${[m(0), m(1), m(2)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export type ContrastIssue = {
  pair: string;
  ratio: number;
  level: "aa" | "fail";
  message: string;
};

export function contrastIssues(palette: { primary: string; primaryFg: string; bg: string; fg: string; surface: string }) {
  const issues: ContrastIssue[] = [];
  const pairs: Array<[string, string, string, number]> = [
    ["Primary button", palette.primary, palette.primaryFg, 4.5],
    ["Body text", palette.bg, palette.fg, 4.5],
    ["Card text", palette.surface, palette.fg, 4.5],
  ];
  for (const [pair, a, b, min] of pairs) {
    const ratio = contrastRatio(a, b);
    if (ratio < min) {
      issues.push({
        pair,
        ratio,
        level: "fail",
        message: `${pair} contrast is ${ratio.toFixed(1)}:1 (need ${min}:1). Pick a darker or lighter colour.`,
      });
    }
  }
  const primaryOnBg = contrastRatio(palette.primary, palette.bg);
  if (primaryOnBg < 2.2) {
    issues.push({
      pair: "Primary on background",
      ratio: primaryOnBg,
      level: "fail",
      message: "Primary is too close to the background — buttons and charts will disappear.",
    });
  }
  return issues;
}
