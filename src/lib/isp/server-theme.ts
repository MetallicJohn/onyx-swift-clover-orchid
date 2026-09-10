import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertPermission } from "./rbac";
import {
  loadPublicBranding,
  loadTenantThemeNamed,
  publicBrandingPayload,
  saveTenantTheme,
  type ThemePatch,
} from "./theme";
import { requireWorkspace as requireWs } from "./workspace";

export const getTenantTheme = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const { config, name, slug } = await loadTenantThemeNamed(sql, tenantId);
    return { ...config, name, slug, displayName: config.displayName || name };
  });

export const saveTenantThemeFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: ThemePatch) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const saved = await saveTenantTheme(sql, tenantId, data);
    return { ...saved, name: tenantName, displayName: saved.displayName || tenantName };
  });

export const getPublicBranding = createServerFn({ method: "POST" })
  .validator((d: { slug: string; surface?: "login" | "portal" | "reseller" }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const row = await loadPublicBranding(sql, data.slug);
    if (!row) return { apply: false as const, branding: null };
    return publicBrandingPayload(row, data.surface || "portal");
  });
