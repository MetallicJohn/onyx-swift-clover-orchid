import { contrastFg, contrastIssues, mixHex, normalizeHex } from "./contrast.ts";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_PRESET,
  PRESET_BY_ID,
  type ThemeAppearance,
  type ThemePalette,
  type ThemePresetId,
} from "./presets.ts";

export type ThemeConfig = {
  tenantId: string;
  preset: ThemePresetId;
  appearance: ThemeAppearance;
  primary: string;
  secondary: string;
  accent: string;
  logo: string;
  favicon: string;
  displayName: string;
  brandLogin: boolean;
  brandPortal: boolean;
};

export type PublicBranding = Omit<ThemeConfig, "tenantId"> & {
  slug: string;
  name: string;
};

export type ResolvedTheme = {
  config: ThemeConfig;
  palette: ThemePalette;
  appearance: "light" | "dark";
  vars: Record<string, string>;
  issues: ReturnType<typeof contrastIssues>;
  displayName: string;
};

export const CSS_VAR_KEYS = [
  "--color-bg",
  "--color-surface",
  "--color-elevated",
  "--color-fg",
  "--color-muted",
  "--color-subtle",
  "--color-border",
  "--color-accent",
  "--color-accent-fg",
  "--color-ok",
  "--color-warn",
  "--color-danger",
  "--color-info",
  "--color-sidebar",
  "--color-header",
  "--color-chart",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--success",
  "--warning",
  "--destructive",
  "--info",
  "--sidebar",
  "--header",
] as const;

export const THEME_CACHE_KEY = "isp-theme.v1";

export function clearThemeCache() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(THEME_CACHE_KEY);
  } catch {
    /* quota */
  }
}

export function emptyThemeConfig(tenantId = "", displayName = ""): ThemeConfig {
  return {
    tenantId,
    preset: DEFAULT_PRESET,
    appearance: DEFAULT_APPEARANCE,
    primary: "",
    secondary: "",
    accent: "",
    logo: "",
    favicon: "",
    displayName,
    brandLogin: true,
    brandPortal: true,
  };
}

export function effectiveAppearance(appearance: ThemeAppearance, systemDark: boolean): "light" | "dark" {
  if (appearance === "system") return systemDark ? "dark" : "light";
  return appearance;
}

export function resolvePalette(config: Pick<ThemeConfig, "preset" | "appearance" | "primary" | "secondary" | "accent">, systemDark: boolean): ThemePalette {
  const preset = PRESET_BY_ID[config.preset] ?? PRESET_BY_ID[DEFAULT_PRESET];
  const dark = effectiveAppearance(config.appearance, systemDark) === "dark";
  const base = dark ? preset.dark : preset.light;
  const primary = normalizeHex(config.primary) || base.primary;
  const secondary = normalizeHex(config.secondary) || (normalizeHex(config.primary) ? mixHex(primary, base.surface, 0.62) : base.secondary);
  const accent = normalizeHex(config.accent) || (normalizeHex(config.primary) ? primary : base.accent);
  return {
    ...base,
    primary,
    primaryFg: contrastFg(primary),
    secondary,
    secondaryFg: contrastFg(secondary),
    accent,
    accentFg: contrastFg(accent),
  };
}

export function cssVars(palette: ThemePalette): Record<string, string> {
  return {
    "--color-bg": palette.bg,
    "--color-surface": palette.surface,
    "--color-elevated": palette.elevated,
    "--color-fg": palette.fg,
    "--color-muted": palette.muted,
    "--color-subtle": palette.subtle,
    "--color-border": palette.border,
    "--color-accent": palette.primary,
    "--color-accent-fg": palette.primaryFg,
    "--color-ok": palette.success,
    "--color-warn": palette.warning,
    "--color-danger": palette.danger,
    "--color-info": palette.info,
    "--color-sidebar": palette.surface,
    "--color-header": palette.bg,
    "--color-chart": palette.primary,
    "--primary": palette.primary,
    "--primary-foreground": palette.primaryFg,
    "--secondary": palette.secondary,
    "--secondary-foreground": palette.secondaryFg,
    "--accent": palette.accent,
    "--accent-foreground": palette.accentFg,
    "--background": palette.bg,
    "--foreground": palette.fg,
    "--card": palette.surface,
    "--card-foreground": palette.fg,
    "--muted": palette.elevated,
    "--muted-foreground": palette.muted,
    "--border": palette.border,
    "--success": palette.success,
    "--warning": palette.warning,
    "--destructive": palette.danger,
    "--info": palette.info,
    "--sidebar": palette.surface,
    "--header": palette.bg,
  };
}

export function resolveTheme(config: ThemeConfig, fallbackName: string, systemDark: boolean): ResolvedTheme {
  const palette = resolvePalette(config, systemDark);
  const appearance = effectiveAppearance(config.appearance, systemDark);
  return {
    config,
    palette,
    appearance,
    vars: cssVars(palette),
    issues: contrastIssues({
      primary: palette.primary,
      primaryFg: palette.primaryFg,
      bg: palette.bg,
      fg: palette.fg,
      surface: palette.surface,
    }),
    displayName: (config.displayName || fallbackName).trim() || "ISP",
  };
}

export function applyCssVars(vars: Record<string, string> | null, appearance: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of CSS_VAR_KEYS) {
    if (vars && vars[key]) root.style.setProperty(key, vars[key]!);
    else root.style.removeProperty(key);
  }
  root.dataset.appearance = appearance;
  root.style.colorScheme = appearance;
}

export function applyFavicon(href: string | null, themeColor: string | null) {
  if (typeof document === "undefined") return;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = href || "/favicon.svg";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && themeColor) meta.content = themeColor;
}
