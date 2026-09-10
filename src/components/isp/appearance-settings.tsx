import { Check, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ThemePreview } from "@/components/isp/theme-preview";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { getTenantTheme, saveTenantThemeFn } from "@/lib/isp/server-theme";
import { MAX_FAVICON_BYTES, MAX_LOGO_BYTES, parseDataImage } from "@/lib/theme/assets";
import { normalizeHex } from "@/lib/theme/contrast";
import { DEFAULT_FONT, THEME_FONTS, applyFontKit, fontFamily } from "@/lib/theme/fonts";
import { DEFAULT_APPEARANCE, DEFAULT_PRESET, THEME_PRESETS, type ThemeAppearance, type ThemePresetId } from "@/lib/theme/presets";
import { emptyThemeConfig, resolvePalette, resolveTheme, type ThemeConfig } from "@/lib/theme/resolve";
import { cn } from "@/lib/utils";

function systemDark() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function isThemeDirty(a: ThemeConfig, b: ThemeConfig) {
  return (
    a.preset !== b.preset ||
    a.appearance !== b.appearance ||
    a.font !== b.font ||
    a.primary !== b.primary ||
    a.secondary !== b.secondary ||
    a.accent !== b.accent ||
    a.logo !== b.logo ||
    a.favicon !== b.favicon ||
    a.displayName !== b.displayName ||
    Boolean(a.brandLogin) !== Boolean(b.brandLogin) ||
    Boolean(a.brandPortal) !== Boolean(b.brandPortal)
  );
}

function ColorField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const hex = normalizeHex(value) || placeholder;
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input
          type="color"
          className="h-11 w-14 p-1"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} picker`}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
        />
        {value ? (
          <Button type="button" variant="secondary" onClick={() => onChange("")} aria-label={`Reset ${label}`}>
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

async function readImage(file: File, maxBytes: number) {
  if (file.size > maxBytes) throw new Error(`Image must be under ${Math.round(maxBytes / 1024)} KB`);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
  return parseDataImage(data, maxBytes);
}

function toConfig(row: {
  tenantId: string;
  preset: ThemeConfig["preset"];
  appearance: ThemeConfig["appearance"];
  font: ThemeConfig["font"];
  primary: string;
  secondary: string;
  accent: string;
  logo: string;
  favicon: string;
  displayName: string;
  name: string;
  brandLogin: boolean;
  brandPortal: boolean;
}): ThemeConfig {
  return {
    tenantId: row.tenantId,
    preset: row.preset,
    appearance: row.appearance,
    font: row.font,
    primary: row.primary,
    secondary: row.secondary,
    accent: row.accent,
    logo: row.logo,
    favicon: row.favicon,
    displayName: row.displayName === row.name ? "" : row.displayName,
    brandLogin: row.brandLogin,
    brandPortal: row.brandPortal,
  };
}

export function AppearanceSettings({ canManage }: { canManage: boolean }) {
  const { apply, preview, clearPreview } = useTheme();
  const [draft, setDraft] = useState<ThemeConfig>(emptyThemeConfig());
  const [saved, setSaved] = useState<ThemeConfig>(emptyThemeConfig());
  const [ispName, setIspName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    applyFontKit(true);
    let cancelled = false;
    getTenantTheme()
      .then((row) => {
        if (cancelled) return;
        const cfg = toConfig(row);
        setIspName(row.name);
        setSaved(cfg);
        setDraft((current) => {
          if (!dirtyRef.current) return cfg;
          return { ...current, tenantId: cfg.tenantId || current.tenantId };
        });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load appearance"));
    return () => {
      cancelled = true;
      applyFontKit(false);
      clearPreview();
    };
  }, [clearPreview]);

  const resolved = useMemo(
    () => resolveTheme({ ...draft, displayName: draft.displayName || ispName }, ispName, systemDark()),
    [draft, ispName],
  );
  const dirty = isThemeDirty(draft, saved);

  useEffect(() => {
    preview({ ...draft, displayName: draft.displayName || ispName }, ispName);
  }, [draft, ispName, preview]);

  function setPatch(patch: Partial<ThemeConfig>) {
    dirtyRef.current = true;
    setDraft((d) => ({ ...d, ...patch }));
    setOk(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-medium">Appearance</h2>
        <p className="mt-1 text-sm text-muted">
          White-label this ISP only. Other networks keep their own colours, type, logo, and login.
        </p>
      </div>

      <ThemePreview palette={resolved.palette} name={resolved.displayName} fontFamily={fontFamily(draft.font)} />

      {resolved.issues.length ? (
        <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          {resolved.issues.map((issue) => (
            <p key={issue.pair}>{issue.message}</p>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-medium">Theme</h3>
        <p className="mt-1 text-sm text-muted">A full palette, not a single colour. Status greens/ambers/reds stay readable.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {THEME_PRESETS.map((preset) => {
            const pal = resolvePalette(
              { preset: preset.id, appearance: draft.appearance, primary: "", secondary: "", accent: "" },
              systemDark(),
            );
            const selected = draft.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setPatch({ preset: preset.id as ThemePresetId, primary: "", secondary: "", accent: "" })}
                className={cn(
                  "min-h-24 rounded-xl border p-3 text-left transition-colors",
                  selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-elevated",
                )}
              >
                <div className="flex gap-1">
                  {[pal.primary, pal.secondary, pal.bg, pal.surface].map((c, i) => (
                    <span key={i} className="h-6 flex-1 rounded-sm" style={{ background: c, boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.12)" }} />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{preset.name}</span>
                  {selected ? <Check className="size-4 text-accent" /> : null}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">{preset.blurb}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium">Typeface</h3>
        <p className="mt-1 text-sm text-muted">
          UI and headings. Amounts, account IDs, and RADIUS usernames stay IBM Plex Mono. Invoices stay Helvetica.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {THEME_FONTS.map((font) => {
            const selected = draft.font === font.id;
            return (
              <button
                key={font.id}
                type="button"
                onClick={() => setPatch({ font: font.id })}
                className={cn(
                  "min-h-20 rounded-xl border p-3 text-left transition-colors",
                  selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-elevated",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg font-medium leading-none" style={{ fontFamily: font.family }}>
                    Ag
                  </span>
                  {selected ? <Check className="size-4 text-accent" /> : null}
                </div>
                <div className="mt-2 text-sm font-medium" style={{ fontFamily: font.family }}>
                  {font.name}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">{font.blurb}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-3">
        <h3 className="font-medium md:col-span-3">Custom colours</h3>
        <ColorField label="Primary" value={draft.primary} placeholder={resolved.palette.primary} onChange={(primary) => setPatch({ primary })} />
        <ColorField label="Secondary" value={draft.secondary} placeholder={resolved.palette.secondary} onChange={(secondary) => setPatch({ secondary })} />
        <ColorField label="Accent" value={draft.accent} placeholder={resolved.palette.accent} onChange={(accent) => setPatch({ accent })} />
        <p className="text-xs text-muted md:col-span-3">
          Leave a field empty to use the preset. Button labels are picked automatically for contrast.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-surface p-4">
        <h3 className="font-medium">Light / dark</h3>
        <div className="flex flex-wrap gap-2">
          {(["dark", "light", "system"] as ThemeAppearance[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPatch({ appearance: mode })}
              className={cn(
                "h-11 min-w-24 rounded-md px-4 text-sm capitalize",
                draft.appearance === mode ? "bg-accent text-accent-fg" : "border border-border bg-bg text-muted hover:text-fg",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
        <h3 className="font-medium sm:col-span-2">Logo & branding</h3>
        <Field label="Display name">
          <Input
            value={draft.displayName}
            onChange={(e) => setPatch({ displayName: e.target.value })}
            placeholder={ispName || "Shown in the sidebar and portal"}
          />
        </Field>
        <div className="hidden sm:block" />
        <AssetSlot
          label="Logo"
          hint="PNG, JPEG or WebP · 400 KB"
          src={draft.logo}
          onFile={async (f) => {
            setFileErr(null);
            try {
              setPatch({ logo: await readImage(f, MAX_LOGO_BYTES) });
            } catch (e) {
              setFileErr(e instanceof Error ? e.message : "Could not use that logo");
            }
          }}
          onClear={() => setPatch({ logo: "" })}
        />
        <AssetSlot
          label="Favicon"
          hint="PNG, JPEG, WebP or ICO · 80 KB"
          src={draft.favicon}
          onFile={async (f) => {
            setFileErr(null);
            try {
              setPatch({ favicon: await readImage(f, MAX_FAVICON_BYTES) });
            } catch (e) {
              setFileErr(e instanceof Error ? e.message : "Could not use that favicon");
            }
          }}
          onClear={() => setPatch({ favicon: "" })}
        />
        {fileErr ? <p className="text-sm text-danger sm:col-span-2">{fileErr}</p> : null}
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
          <input type="checkbox" checked={draft.brandLogin} onChange={(e) => setPatch({ brandLogin: e.target.checked })} />
          Brand the operator login when opened with this ISP’s slug
        </label>
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
          <input type="checkbox" checked={draft.brandPortal} onChange={(e) => setPatch({ brandPortal: e.target.checked })} />
          Brand the customer portal and reseller desk
        </label>
      </div>

      {err ? <p className="text-sm text-danger">{err}</p> : null}
      {ok ? <p className="text-sm text-ok">{ok}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!canManage || busy || !dirty}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            setOk(null);
            try {
              const row = await saveTenantThemeFn({
                data: {
                  preset: draft.preset,
                  appearance: draft.appearance,
                  font: draft.font,
                  primary: draft.primary,
                  secondary: draft.secondary,
                  accent: draft.accent,
                  logo: draft.logo && draft.logo !== saved.logo ? draft.logo : undefined,
                  favicon: draft.favicon && draft.favicon !== saved.favicon ? draft.favicon : undefined,
                  clearLogo: !draft.logo && Boolean(saved.logo),
                  clearFavicon: !draft.favicon && Boolean(saved.favicon),
                  displayName: draft.displayName,
                  brandLogin: draft.brandLogin,
                  brandPortal: draft.brandPortal,
                },
              });
              const next: ThemeConfig = { ...draft, tenantId: row.tenantId, logo: row.logo, favicon: row.favicon };
              dirtyRef.current = false;
              setSaved(next);
              setDraft(next);
              apply(next, ispName);
              setOk("Appearance saved for this ISP.");
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Could not save appearance");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save appearance"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty}
          onClick={() => {
            dirtyRef.current = false;
            setDraft(saved);
            apply(saved, ispName);
            setOk(null);
            setErr(null);
          }}
        >
          Revert
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            setPatch({
              preset: DEFAULT_PRESET,
              appearance: DEFAULT_APPEARANCE,
              font: DEFAULT_FONT,
              primary: "",
              secondary: "",
              accent: "",
            })
          }
        >
          Reset palette
        </Button>
        {!canManage ? <p className="self-center text-sm text-muted">Only an owner or admin can save branding.</p> : null}
      </div>
    </div>
  );
}

function AssetSlot({
  label,
  hint,
  src,
  onFile,
  onClear,
}: {
  label: string;
  hint: string;
  src: string;
  onFile: (file: File) => void | Promise<void>;
  onClear: () => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <div className="grid size-14 place-items-center overflow-hidden rounded-md border border-border bg-bg">
          {src ? <img src={src} alt="" className="max-h-full max-w-full object-contain" /> : <Upload className="size-4 text-muted" />}
        </div>
        <div className="min-w-0 flex-1">
          <label className="inline-flex h-11 cursor-pointer items-center rounded-md border border-border bg-bg px-3 text-sm">
            Replace
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/x-icon,.ico"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onFile(file);
              }}
            />
          </label>
          {src ? (
            <button type="button" className="ml-2 h-11 text-sm text-muted hover:text-fg" onClick={onClear}>
              Remove
            </button>
          ) : null}
          <p className="mt-1 text-[11px] text-subtle">{hint}</p>
        </div>
      </div>
    </Field>
  );
}
