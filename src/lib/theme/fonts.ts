/** Curated UI typefaces. IDs only — never accept a free-form font-family string. */

export type ThemeFontId =
  | "outfit"
  | "dm-sans"
  | "inter"
  | "ibm-plex-sans"
  | "source-sans"
  | "manrope"
  | "jakarta"
  | "figtree"
  | "public-sans"
  | "nunito-sans";

export type ThemeFont = {
  id: ThemeFontId;
  name: string;
  blurb: string;
  /** CSS font-family stack. Quotes are required for multi-word names. */
  family: string;
  /** Google Fonts css2 `family=` value, or empty when already in the document shell. */
  google: string;
};

const FALLBACK = "ui-sans-serif, system-ui, sans-serif";

export const THEME_FONTS: ThemeFont[] = [
  { id: "outfit", name: "Outfit", blurb: "Default ISP Solutions type.", family: `"Outfit", ${FALLBACK}`, google: "Outfit:wght@400;500;600;700" },
  { id: "dm-sans", name: "DM Sans", blurb: "Geometric, quiet product UI.", family: `"DM Sans", ${FALLBACK}`, google: "DM+Sans:wght@400;500;600;700" },
  { id: "inter", name: "Inter", blurb: "Dense screens and long tables.", family: `"Inter", ${FALLBACK}`, google: "Inter:wght@400;500;600;700" },
  { id: "ibm-plex-sans", name: "IBM Plex Sans", blurb: "Pairs with the existing mono.", family: `"IBM Plex Sans", ${FALLBACK}`, google: "IBM+Plex+Sans:wght@400;500;600;700" },
  { id: "source-sans", name: "Source Sans 3", blurb: "Neutral utility face for ops.", family: `"Source Sans 3", ${FALLBACK}`, google: "Source+Sans+3:wght@400;500;600;700" },
  { id: "manrope", name: "Manrope", blurb: "Modern geometric, slightly wide.", family: `"Manrope", ${FALLBACK}`, google: "Manrope:wght@400;500;600;700" },
  { id: "jakarta", name: "Plus Jakarta Sans", blurb: "Distinct brand without shouting.", family: `"Plus Jakarta Sans", ${FALLBACK}`, google: "Plus+Jakarta+Sans:wght@400;500;600;700" },
  { id: "figtree", name: "Figtree", blurb: "Friendly customer-facing portal.", family: `"Figtree", ${FALLBACK}`, google: "Figtree:wght@400;500;600;700" },
  { id: "public-sans", name: "Public Sans", blurb: "Civic / utility tone.", family: `"Public Sans", ${FALLBACK}`, google: "Public+Sans:wght@400;500;600;700" },
  { id: "nunito-sans", name: "Nunito Sans", blurb: "Soft, rounded, readable.", family: `"Nunito Sans", ${FALLBACK}`, google: "Nunito+Sans:wght@400;500;600;700" },
];

export const DEFAULT_FONT: ThemeFontId = "outfit";

export const FONT_BY_ID: Record<ThemeFontId, ThemeFont> = Object.fromEntries(THEME_FONTS.map((f) => [f.id, f])) as Record<
  ThemeFontId,
  ThemeFont
>;

export function isFontId(value: string): value is ThemeFontId {
  return value in FONT_BY_ID;
}

export function fontFamily(id: ThemeFontId | string | undefined): string {
  const font = (id && isFontId(id) ? FONT_BY_ID[id] : FONT_BY_ID[DEFAULT_FONT]) ?? FONT_BY_ID[DEFAULT_FONT];
  return font.family;
}

export function googleStylesheet(id: ThemeFontId | string | undefined): string | null {
  const font = id && isFontId(id) ? FONT_BY_ID[id] : null;
  if (!font?.google) return null;
  if (font.id === DEFAULT_FONT) return null;
  return `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
}

export function googleKitStylesheet(): string {
  const families = THEME_FONTS.map((f) => `family=${f.google}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

const TENANT_LINK = "isp-tenant-font";
const KIT_LINK = "isp-font-kit";

function upsertLink(id: string, href: string | null) {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  if (!href) {
    existing?.remove();
    return;
  }
  if (existing) {
    if (existing.getAttribute("href") !== href) existing.href = href;
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/** Load the active tenant face. Outfit is already in the document shell. */
export function applyFontLink(href: string | null) {
  upsertLink(TENANT_LINK, href);
}

/** Load every curated face while the Appearance picker is open. */
export function applyFontKit(on: boolean) {
  upsertLink(KIT_LINK, on ? googleKitStylesheet() : null);
}
