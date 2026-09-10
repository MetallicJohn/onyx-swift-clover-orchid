import { MAX_FAVICON_BYTES, MAX_LOGO_BYTES, parseDataImage } from "../theme/assets.ts";
import { normalizeHex } from "../theme/contrast.ts";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_PRESET,
  isAppearance,
  isPresetId,
  type ThemeAppearance,
  type ThemePresetId,
} from "../theme/presets.ts";
import { emptyThemeConfig, resolvePalette, type PublicBranding, type ThemeConfig } from "../theme/resolve.ts";
import { applyRls } from "./rls.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

type ThemeRow = {
  id: string;
  name: string;
  slug: string;
  theme_preset: string;
  theme_appearance: string;
  theme_primary: string;
  theme_secondary: string;
  theme_accent: string;
  theme_logo: string;
  theme_favicon: string;
  theme_display_name: string;
  theme_brand_login: boolean;
  theme_brand_portal: boolean;
};

function rowToConfig(row: ThemeRow): ThemeConfig {
  return {
    tenantId: row.id,
    preset: isPresetId(row.theme_preset) ? row.theme_preset : DEFAULT_PRESET,
    appearance: isAppearance(row.theme_appearance) ? row.theme_appearance : DEFAULT_APPEARANCE,
    primary: row.theme_primary || "",
    secondary: row.theme_secondary || "",
    accent: row.theme_accent || "",
    logo: row.theme_logo || "",
    favicon: row.theme_favicon || "",
    displayName: row.theme_display_name || "",
    brandLogin: row.theme_brand_login !== false,
    brandPortal: row.theme_brand_portal !== false,
  };
}

const THEME_SELECT = `id, name, slug,
  coalesce(theme_preset, 'teal') as theme_preset,
  coalesce(theme_appearance, 'dark') as theme_appearance,
  coalesce(theme_primary, '') as theme_primary,
  coalesce(theme_secondary, '') as theme_secondary,
  coalesce(theme_accent, '') as theme_accent,
  coalesce(theme_logo, '') as theme_logo,
  coalesce(theme_favicon, '') as theme_favicon,
  coalesce(theme_display_name, '') as theme_display_name,
  coalesce(theme_brand_login, true) as theme_brand_login,
  coalesce(theme_brand_portal, true) as theme_brand_portal`;

export async function loadTenantThemeNamed(sql: Sql, tenantId: string) {
  const rows = await sql.query<ThemeRow>(`select ${THEME_SELECT} from tenants where id = $1`, [tenantId]);
  const ten = rows[0];
  if (!ten) return { config: emptyThemeConfig(tenantId), name: "", slug: "" };
  return { config: rowToConfig(ten), name: ten.name, slug: ten.slug };
}

export async function loadTenantTheme(sql: Sql, tenantId: string): Promise<ThemeConfig> {
  const { config } = await loadTenantThemeNamed(sql, tenantId);
  return config;
}

export async function loadPublicBranding(sql: Sql, slug: string): Promise<PublicBranding | null> {
  const trimmed = slug.trim().toLowerCase();
  if (!trimmed || trimmed.length > 64) return null;
  await applyRls(sql, { bypass: true });
  try {
    const rows = await sql.query<ThemeRow>(`select ${THEME_SELECT} from tenants where slug = $1`, [trimmed]);
    const ten = rows[0] ?? null;
    if (!ten) return null;
    return { ...rowToConfig(ten), slug: ten.slug, name: ten.name };
  } finally {
    await applyRls(sql, { bypass: false, tenantId: "" });
  }
}

export type ThemePatch = {
  preset?: string;
  appearance?: string;
  primary?: string;
  secondary?: string;
  accent?: string;
  logo?: string;
  favicon?: string;
  displayName?: string;
  brandLogin?: boolean;
  brandPortal?: boolean;
  clearLogo?: boolean;
  clearFavicon?: boolean;
};

function requireHex(label: string, raw: string | undefined) {
  if (raw == null) return undefined;
  const v = raw.trim();
  if (!v) return "";
  const hex = normalizeHex(v);
  if (!hex) throw new Error(`${label} must be a hex colour like #4aa8a0`);
  return hex;
}

export async function saveTenantTheme(sql: Sql, tenantId: string, patch: ThemePatch): Promise<ThemeConfig> {
  const current = await loadTenantTheme(sql, tenantId);
  let preset: ThemePresetId = current.preset;
  if (patch.preset != null) {
    if (!isPresetId(patch.preset)) throw new Error("Unknown theme preset");
    preset = patch.preset;
  }
  let appearance: ThemeAppearance = current.appearance;
  if (patch.appearance != null) {
    if (!isAppearance(patch.appearance)) throw new Error("Appearance must be light, dark, or system");
    appearance = patch.appearance;
  }
  const primary = requireHex("Primary", patch.primary) ?? current.primary;
  const secondary = requireHex("Secondary", patch.secondary) ?? current.secondary;
  const accent = requireHex("Accent", patch.accent) ?? current.accent;
  let logo = current.logo;
  let favicon = current.favicon;
  if (patch.clearLogo) logo = "";
  else if (patch.logo != null) logo = parseDataImage(patch.logo, MAX_LOGO_BYTES);
  if (patch.clearFavicon) favicon = "";
  else if (patch.favicon != null) favicon = parseDataImage(patch.favicon, MAX_FAVICON_BYTES);
  const displayName = patch.displayName != null ? patch.displayName.trim().slice(0, 80) : current.displayName;
  const brandLogin = patch.brandLogin ?? current.brandLogin;
  const brandPortal = patch.brandPortal ?? current.brandPortal;
  const invoiceColor = resolvePalette({ preset, appearance, primary, secondary, accent }, true).primary;

  await sql.query(
    `update tenants set
      theme_preset = $2,
      theme_appearance = $3,
      theme_primary = $4,
      theme_secondary = $5,
      theme_accent = $6,
      theme_logo = $7,
      theme_favicon = $8,
      theme_display_name = $9,
      theme_brand_login = $10,
      theme_brand_portal = $11,
      brand_color = $12
     where id = $1`,
    [
      tenantId,
      preset,
      appearance,
      primary,
      secondary,
      accent,
      logo,
      favicon,
      displayName,
      brandLogin,
      brandPortal,
      invoiceColor,
    ],
  );
  return {
    tenantId,
    preset,
    appearance,
    primary,
    secondary,
    accent,
    logo,
    favicon,
    displayName,
    brandLogin,
    brandPortal,
  };
}

export function publicBrandingPayload(row: PublicBranding, surface: "login" | "portal" | "reseller") {
  const apply = surface === "login" ? row.brandLogin : row.brandPortal;
  if (!apply) return { apply: false as const, branding: null };
  return {
    apply: true as const,
    branding: {
      slug: row.slug,
      name: row.name,
      displayName: row.displayName || row.name,
      preset: row.preset,
      appearance: row.appearance,
      primary: row.primary,
      secondary: row.secondary,
      accent: row.accent,
      logo: row.logo,
      favicon: row.favicon,
      brandLogin: row.brandLogin,
      brandPortal: row.brandPortal,
    },
  };
}
