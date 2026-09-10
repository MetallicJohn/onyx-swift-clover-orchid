import { contrastFg } from "./contrast.ts";

export type ThemeAppearance = "light" | "dark" | "system";

export type ThemePresetId =
  | "ocean"
  | "sky"
  | "royal"
  | "emerald"
  | "teal"
  | "purple"
  | "indigo"
  | "red"
  | "orange"
  | "slate"
  | "dark"
  | "light";

export type ThemePalette = {
  bg: string;
  surface: string;
  elevated: string;
  fg: string;
  muted: string;
  subtle: string;
  border: string;
  primary: string;
  primaryFg: string;
  secondary: string;
  secondaryFg: string;
  accent: string;
  accentFg: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
};

export type ThemePreset = {
  id: ThemePresetId;
  name: string;
  blurb: string;
  dark: ThemePalette;
  light: ThemePalette;
};

const STATUS_DARK = { success: "#6db58a", warning: "#d4a35c", danger: "#d46a6a", info: "#6b9fd4" };
const STATUS_LIGHT = { success: "#2f8a57", warning: "#b47a20", danger: "#c44545", info: "#2b6cb0" };

function darkInk(primary: string, secondary: string, accent: string, bg = "#0a0e13", surface = "#11181f"): ThemePalette {
  return {
    bg,
    surface,
    elevated: "#172028",
    fg: "#e8eef4",
    muted: "#8b98a5",
    subtle: "#66707a",
    border: "#24303a",
    primary,
    primaryFg: contrastFg(primary),
    secondary,
    secondaryFg: contrastFg(secondary),
    accent,
    accentFg: contrastFg(accent),
    ...STATUS_DARK,
  };
}

function lightPaper(primary: string, secondary: string, accent: string, bg = "#f4f6f8", surface = "#ffffff"): ThemePalette {
  return {
    bg,
    surface,
    elevated: "#eef1f4",
    fg: "#1b232c",
    muted: "#5e6a74",
    subtle: "#7a868f",
    border: "#d5dde3",
    primary,
    primaryFg: contrastFg(primary),
    secondary,
    secondaryFg: contrastFg(secondary),
    accent,
    accentFg: contrastFg(accent),
    ...STATUS_LIGHT,
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "ocean",
    name: "Ocean Blue",
    blurb: "Deep coastal navy for network operations.",
    dark: darkInk("#3b82b8", "#1e4e72", "#5ba4c9", "#0a1016", "#111c26"),
    light: lightPaper("#1d6fa3", "#d5e7f3", "#0e7490", "#f3f7fa"),
  },
  {
    id: "sky",
    name: "Sky Blue",
    blurb: "Clear, open, and easy to scan all day.",
    dark: darkInk("#0ea5e9", "#0369a1", "#38bdf8", "#0a1218", "#111d26"),
    light: lightPaper("#0284c7", "#d0ebf8", "#0369a1", "#f2f8fb"),
  },
  {
    id: "royal",
    name: "Royal Blue",
    blurb: "Confident enterprise blue.",
    dark: darkInk("#2563eb", "#1e3a8a", "#60a5fa", "#0a0e16", "#111624"),
    light: lightPaper("#1d4ed8", "#dbe4fb", "#1e40af", "#f4f6fb"),
  },
  {
    id: "emerald",
    name: "Emerald",
    blurb: "Growth-green, still quiet on the surfaces.",
    dark: darkInk("#059669", "#065f46", "#34d399", "#0a100e", "#111a16"),
    light: lightPaper("#047857", "#d4efe4", "#065f46", "#f3f8f5"),
  },
  {
    id: "teal",
    name: "Teal",
    blurb: "The default ISP Solutions console.",
    dark: darkInk("#4aa8a0", "#1f5c57", "#6bc4bc"),
    light: lightPaper("#2f7d76", "#d5eeeb", "#1f5c57"),
  },
  {
    id: "purple",
    name: "Purple",
    blurb: "Violet brand for a distinct ISP identity.",
    dark: darkInk("#7c3aed", "#4c1d95", "#a78bfa", "#0e0b14", "#171421"),
    light: lightPaper("#6d28d9", "#e8defb", "#4c1d95", "#f6f3fb"),
  },
  {
    id: "indigo",
    name: "Indigo",
    blurb: "Cool indigo for dense data screens.",
    dark: darkInk("#4f46e5", "#312e81", "#818cf8", "#0c0c16", "#151528"),
    light: lightPaper("#4338ca", "#e0e0f8", "#312e81", "#f4f4fb"),
  },
  {
    id: "red",
    name: "Red",
    blurb: "Bold mark, restrained ink surfaces.",
    dark: darkInk("#dc2626", "#7f1d1d", "#f87171", "#120a0c", "#1c1214"),
    light: lightPaper("#b91c1c", "#f8dede", "#7f1d1d", "#fbf4f4"),
  },
  {
    id: "orange",
    name: "Orange",
    blurb: "Warm field-ops energy without glare.",
    dark: darkInk("#ea580c", "#7c2d12", "#fb923c", "#120e0a", "#1c1712"),
    light: lightPaper("#c2410c", "#f8e4d6", "#7c2d12", "#fbf6f1"),
  },
  {
    id: "slate",
    name: "Slate",
    blurb: "Near-neutral chrome, colour only on actions.",
    dark: darkInk("#64748b", "#334155", "#94a3b8"),
    light: lightPaper("#475569", "#e2e8f0", "#334155"),
  },
  {
    id: "dark",
    name: "Dark Professional",
    blurb: "Ink surfaces, teal actions — the platform look.",
    dark: darkInk("#4aa8a0", "#172028", "#4aa8a0"),
    light: lightPaper("#2f7d76", "#eef1f4", "#1f5c57"),
  },
  {
    id: "light",
    name: "Light Professional",
    blurb: "Paper desk, teal actions, daylight contrast.",
    dark: darkInk("#4aa8a0", "#1f5c57", "#6bc4bc"),
    light: lightPaper("#2f7d76", "#d5eeeb", "#1f5c57", "#f6f3ec", "#ffffff"),
  },
];

export const DEFAULT_PRESET: ThemePresetId = "teal";
export const DEFAULT_APPEARANCE: ThemeAppearance = "dark";

export const PRESET_BY_ID: Record<ThemePresetId, ThemePreset> = Object.fromEntries(
  THEME_PRESETS.map((p) => [p.id, p]),
) as Record<ThemePresetId, ThemePreset>;

export function isPresetId(value: string): value is ThemePresetId {
  return value in PRESET_BY_ID;
}

export function isAppearance(value: string): value is ThemeAppearance {
  return value === "light" || value === "dark" || value === "system";
}
