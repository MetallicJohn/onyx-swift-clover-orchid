import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { THEME_FONTS } from "@/lib/theme/fonts";
import { HOTSPOT_HTML_FILES } from "@/lib/isp/hotspot-dashboard-format";
import type { HotspotPortalSettings } from "@/lib/isp/hotspot-portal";
import {
  deployHotspotPortalFn,
  getHotspotPortalFn,
  pollHotspotDeployFn,
  previewHotspotPortalFn,
  saveHotspotPortalFn,
} from "@/lib/isp/server-hotspot";
import { cn } from "@/lib/utils";

type PortalPayload = Awaited<ReturnType<typeof getHotspotPortalFn>>;
type PreviewFrame = "mobile" | "tablet" | "desktop";

const FRAME_W: Record<PreviewFrame, string> = {
  mobile: "w-[320px]",
  tablet: "w-[520px]",
  desktop: "w-full max-w-[720px]",
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

export function HotspotBuilderPanel() {
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [form, setForm] = useState<HotspotPortalSettings | null>(null);
  const [file, setFile] = useState<(typeof HOTSPOT_HTML_FILES)[number]>("login.html");
  const [frame, setFrame] = useState<PreviewFrame>("mobile");
  const [routerId, setRouterId] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const next = await getHotspotPortalFn();
    setPayload(next);
    setForm(next.settings);
    if (!routerId && next.routers[0]) setRouterId(next.routers[0].id);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load builder"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!form) return;
    const handle = window.setTimeout(() => {
      void previewHotspotPortalFn({ data: { ...form, file } })
        .then((r) => {
          setPreviewHtml(r.html);
        })
        .catch(() => undefined);
    }, 280);
    return () => window.clearTimeout(handle);
  }, [form, file]);

  useEffect(() => {
    if (!payload?.deployment || payload.deployment.verdict?.verified) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void pollHotspotDeployFn({ data: { router_id: routerId || undefined } })
        .then((r) => {
          if (cancelled || !r.deployment) return;
          setPayload((p) => (p ? { ...p, deployment: { ...r.deployment, verdict: r.verdict } } : p));
        })
        .catch(() => undefined);
    }, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [payload?.deployment?.id, payload?.deployment?.verdict?.verified, routerId]);

  function patch<K extends keyof HotspotPortalSettings>(key: K, value: HotspotPortalSettings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setNote(null);
    try {
      const saved = await saveHotspotPortalFn({ data: form });
      setForm(saved.settings);
      setPayload((p) => (p ? { ...p, settings: saved.settings, files: saved.files } : p));
      setNote({ ok: true, text: "Login page saved." });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    if (!routerId) {
      setNote({ ok: false, text: "Select a hotspot router." });
      return;
    }
    setDeployBusy(true);
    setNote(null);
    try {
      if (form) {
        const saved = await saveHotspotPortalFn({ data: form });
        setForm(saved.settings);
        setPayload((p) => (p ? { ...p, settings: saved.settings, files: saved.files } : p));
      }
      const out = await deployHotspotPortalFn({ data: { router_id: routerId } });
      setNote({ ok: out.verified, text: out.message });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Deploy failed" });
    } finally {
      setDeployBusy(false);
    }
  }

  if (error && !form) return <p className="text-sm text-danger">{error}</p>;
  if (!form || !payload) return <p className="text-sm text-muted">Loading hotspot builder…</p>;

  const verdict = payload.deployment?.verdict;
  const deployTone = verdict?.verified ? "ok" : verdict?.status === "failed" ? "danger" : "warn";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_1fr]">
      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="font-medium">Login page</h2>
        <Field label="Title">
          <Input value={form.title} onChange={(e) => patch("title", e.target.value)} maxLength={80} />
        </Field>
        <Field label="Welcome">
          <Input value={form.welcome} onChange={(e) => patch("welcome", e.target.value)} maxLength={160} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Accent">
            <Input type="color" className="h-11 p-1" value={form.primary_color} onChange={(e) => patch("primary_color", e.target.value)} />
          </Field>
          <Field label="Background">
            <Input type="color" className="h-11 p-1" value={form.background_color} onChange={(e) => patch("background_color", e.target.value)} />
          </Field>
          <Field label="Text">
            <Input type="color" className="h-11 p-1" value={form.text_color} onChange={(e) => patch("text_color", e.target.value)} />
          </Field>
        </div>
        <Field label="Typeface">
          <Select value={form.font_family} onChange={(e) => patch("font_family", e.target.value)}>
            {THEME_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="system-ui">System UI</option>
          </Select>
        </Field>
        <Field label="Logo">
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void fileToDataUrl(f).then((data) => patch("logo_data", data));
            }}
          />
          {form.logo_data ? (
            <button type="button" className="mt-1 text-xs text-muted hover:text-fg" onClick={() => patch("logo_data", "")}>
              Remove logo
            </button>
          ) : null}
        </Field>
        <Field label="Background image">
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void fileToDataUrl(f).then((data) => patch("background_image", data));
            }}
          />
          {form.background_image ? (
            <button type="button" className="mt-1 text-xs text-muted hover:text-fg" onClick={() => patch("background_image", "")}>
              Remove background
            </button>
          ) : null}
        </Field>
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm">
          <input type="checkbox" checked={form.show_voucher} onChange={(e) => patch("show_voucher", e.target.checked)} />
          Voucher login
        </label>
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm">
          <input type="checkbox" checked={form.show_customer} onChange={(e) => patch("show_customer", e.target.checked)} />
          Customer login
        </label>
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm">
          <input type="checkbox" checked={form.show_packages} onChange={(e) => patch("show_packages", e.target.checked)} />
          Show packages
        </label>
        <Field label="Terms">
          <Textarea value={form.terms} onChange={(e) => patch("terms", e.target.value)} rows={3} />
        </Field>
        <Field label="Support phone">
          <Input value={form.support_phone} onChange={(e) => patch("support_phone", e.target.value)} />
        </Field>
        <Field label="Support email">
          <Input value={form.support_email} onChange={(e) => patch("support_email", e.target.value)} />
        </Field>
        <Field label="Payment instructions">
          <Textarea value={form.payment_instructions} onChange={(e) => patch("payment_instructions", e.target.value)} rows={3} />
        </Field>
        <Field label="Custom CSS">
          <Textarea value={form.custom_css} onChange={(e) => patch("custom_css", e.target.value)} rows={4} className="font-mono text-xs" />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save page"}
        </Button>

        <div className="mt-2 grid gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">Deploy to router</h3>
          <Field label="Hotspot router">
            <Select value={routerId} onChange={(e) => setRouterId(e.target.value)}>
              <option value="">Select router</option>
              {payload.routers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.online ? " · online" : ` · ${r.status}`}
                </option>
              ))}
            </Select>
          </Field>
          {payload.routers.length === 0 ? (
            <p className="text-xs text-muted">No hotspot routers. Set a router’s role to Hotspot, then bootstrap it.</p>
          ) : null}
          <Button type="button" variant="secondary" disabled={!payload.can_deploy || deployBusy} onClick={() => void deploy()}>
            {deployBusy ? "Deploying…" : "Deploy files"}
          </Button>
          {!payload.can_deploy ? <p className="text-xs text-muted">Deploying requires router management permission.</p> : null}
          {verdict ? (
            <p className="text-sm">
              <Badge tone={statusTone(deployTone === "ok" ? "online" : deployTone === "danger" ? "offline" : "grace")}>
                {verdict.status.replaceAll("_", " ")}
              </Badge>
              <span className="ml-2 text-muted">{verdict.message}</span>
            </p>
          ) : null}
        </div>
        {note ? <p className={cn("text-sm", note.ok ? "text-ok" : "text-danger")}>{note.text}</p> : null}
      </form>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Select aria-label="Preview file" className="h-9 w-40" value={file} onChange={(e) => setFile(e.target.value as typeof file)}>
            {HOTSPOT_HTML_FILES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <div className="flex rounded-lg border border-border bg-surface p-1" role="group" aria-label="Preview size">
            {(
              [
                ["mobile", Smartphone],
                ["tablet", Tablet],
                ["desktop", Monitor],
              ] as const
            ).map(([id, Icon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={frame === id}
                aria-label={id}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-md",
                  frame === id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
                )}
                onClick={() => setFrame(id)}
              >
                <Icon className="size-4" strokeWidth={1.75} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-center overflow-auto rounded-xl border border-border bg-elevated p-4">
          <iframe
            title="Hotspot login preview"
            sandbox="allow-scripts"
            className={cn("h-[640px] rounded-lg border border-border bg-bg", FRAME_W[frame])}
            srcDoc={
              file === "md5.js"
                ? `<pre style="white-space:pre-wrap;font:12px ui-monospace,monospace;padding:12px">${previewHtml
                    .replace(/&/g, "\u0026amp;")
                    .replace(/</g, "\u0026lt;")}</pre>`
                : previewHtml
            }
          />
        </div>
        <p className="text-xs text-subtle">
          Preview uses sample MikroTik variables. Deploy writes login.html, status.html, logout.html, alogin.html, error.html, and md5.js.
        </p>
      </div>
    </div>
  );
}
