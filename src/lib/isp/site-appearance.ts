import { applyCssVars, applyFavicon } from "@/lib/theme/resolve";

export const SITE_APPEARANCE_KEY = "isp-site-appearance";
export type SiteAppearance = "light" | "dark" | "system";

const MARKETING = new Set(["/", "/about", "/privacy", "/terms", "/acceptable-use"]);

export function isMarketingPath(pathname: string) {
  return MARKETING.has(pathname);
}

export function readSiteAppearance(): SiteAppearance {
  if (typeof localStorage === "undefined") return "system";
  try {
    const v = localStorage.getItem(SITE_APPEARANCE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* private mode */
  }
  return "system";
}

export function writeSiteAppearance(mode: SiteAppearance) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SITE_APPEARANCE_KEY, mode);
  } catch {
    /* quota */
  }
}

export function systemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveSiteAppearance(mode: SiteAppearance, systemDark = systemPrefersDark()): "light" | "dark" {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

const LIGHT_THEME = "#f4f6f8";
const DARK_THEME = "#0a0e13";

export function paintSiteAppearance(mode: SiteAppearance = readSiteAppearance()) {
  const appearance = resolveSiteAppearance(mode);
  applyCssVars(null, appearance);
  applyFavicon(null, appearance === "light" ? LIGHT_THEME : DARK_THEME);
}

export function paintPlatformDefault() {
  applyCssVars(null, "dark");
  applyFavicon(null, DARK_THEME);
}
