import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getPublicBranding } from "@/lib/isp/server-theme";
import { applyFontLink, googleStylesheet } from "@/lib/theme/fonts";
import {
  THEME_CACHE_KEY,
  applyCssVars,
  applyFavicon,
  resolveTheme,
  type ResolvedTheme,
  type ThemeConfig,
} from "@/lib/theme/resolve";

type ThemeApi = {
  resolved: ResolvedTheme | null;
  apply: (config: ThemeConfig | null, fallbackName?: string) => void;
  preview: (config: ThemeConfig, fallbackName?: string) => void;
  clearPreview: () => void;
};

const ThemeCtx = createContext<ThemeApi>({
  resolved: null,
  apply: () => {},
  preview: () => {},
  clearPreview: () => {},
});

type CachePayload = {
  tenantId: string;
  vars: Record<string, string>;
  appearance: "light" | "dark";
  fontHref?: string | null;
};

function systemDark() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readCache(): CachePayload | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed?.tenantId || !parsed.vars) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(tenantId: string, vars: Record<string, string>, appearance: "light" | "dark", fontHref: string | null) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ tenantId, vars, appearance, fontHref }));
  } catch {
    /* quota */
  }
}

function paint(resolved: ResolvedTheme | null) {
  if (!resolved) {
    applyCssVars(null, "dark");
    applyFavicon(null, "#0a0e13");
    applyFontLink(null);
    return;
  }
  applyCssVars(resolved.vars, resolved.appearance);
  applyFavicon(resolved.config.favicon || null, resolved.palette.bg);
  applyFontLink(googleStylesheet(resolved.config.font));
}

function onAppPath() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/app");
}

function paintCachedForApp() {
  if (!onAppPath()) return false;
  const cached = readCache();
  if (!cached) return false;
  applyCssVars(cached.vars, cached.appearance);
  applyFontLink(cached.fontHref || null);
  return true;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [committed, setCommitted] = useState<ThemeConfig | null>(null);
  const [previewCfg, setPreviewCfg] = useState<ThemeConfig | null>(null);
  const [fallbackName, setFallbackName] = useState("ISP");
  const [dark, setDark] = useState(true);

  useEffect(() => {
    paintCachedForApp();
    setDark(systemDark());
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const active = previewCfg ?? committed;
  const resolved = useMemo(
    () => (active ? resolveTheme(active, fallbackName, dark) : null),
    [active, fallbackName, dark],
  );

  useEffect(() => {
    if (resolved) {
      paint(resolved);
      if (committed && !previewCfg) {
        writeCache(committed.tenantId, resolved.vars, resolved.appearance, googleStylesheet(committed.font));
      }
      return;
    }
    if (onAppPath() && paintCachedForApp()) return;
    paint(null);
  }, [resolved, committed, previewCfg]);

  const apply = useCallback((config: ThemeConfig | null, name = "ISP") => {
    setFallbackName(name);
    if (!config) {
      setPreviewCfg(null);
      setCommitted(null);
      return;
    }
    const cached = readCache();
    if (cached && cached.tenantId === config.tenantId) {
      applyCssVars(cached.vars, cached.appearance);
      applyFontLink(cached.fontHref || null);
    }
    setCommitted(config);
  }, []);

  const preview = useCallback((config: ThemeConfig, name = "ISP") => {
    setFallbackName(name);
    setPreviewCfg(config);
  }, []);

  const clearPreview = useCallback(() => setPreviewCfg(null), []);

  const api = useMemo(() => ({ resolved, apply, preview, clearPreview }), [resolved, apply, preview, clearPreview]);

  return <ThemeCtx.Provider value={api}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

export function usePublicTheme(slug: string, surface: "login" | "portal" | "reseller") {
  const { apply, resolved } = useTheme();
  const [meta, setMeta] = useState<{ displayName: string; logo: string; name: string } | null>(null);

  useEffect(() => {
    const trimmed = slug.trim();
    if (trimmed.length < 2) {
      apply(null);
      setMeta(null);
      return;
    }
    let cancelled = false;
    getPublicBranding({ data: { slug: trimmed, surface } })
      .then((r) => {
        if (cancelled) return;
        if (!r.apply || !r.branding) {
          apply(null);
          setMeta(null);
          return;
        }
        const b = r.branding;
        apply(
          {
            tenantId: `slug:${b.slug}`,
            preset: b.preset,
            appearance: b.appearance,
            font: b.font,
            primary: b.primary,
            secondary: b.secondary,
            accent: b.accent,
            logo: b.logo,
            favicon: b.favicon,
            displayName: b.displayName,
            brandLogin: b.brandLogin,
            brandPortal: b.brandPortal,
          },
          b.displayName,
        );
        setMeta({ displayName: b.displayName, logo: b.logo, name: b.name });
      })
      .catch(() => {
        if (!cancelled) {
          apply(null);
          setMeta(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, surface, apply]);

  return { branding: meta, resolved };
}
