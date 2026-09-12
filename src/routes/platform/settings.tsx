import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHead, Panel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { getSaasSettings, saveSaasSettings } from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/settings")({ component: SettingsPage });

function SettingsPage() {
  const [form, setForm] = useState({
    grace_days: 3,
    past_due_days: 7,
    trial_days: 14,
    support_access_enabled: false,
    support_access_minutes: 30,
    sales_email: "",
    support_email: "",
    contact_phone: "",
    acs_public_host: "",
    acs_dns_host: "",
    acs_port_start: 7551,
    acs_port_end: 7999,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    getSaasSettings()
      .then(setForm)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);

  return (
    <div>
      <PageHead
        eyebrow="Platform"
        title="System settings"
        hint={`${APP_NAME} defaults for trials, dunning, and optional support access. Tenant branding is never edited here.`}
      />
      <Panel>
        <form
          className="grid max-w-xl gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setOk(null);
            try {
              const saved = await saveSaasSettings({ data: form });
              setForm(saved);
              setOk("Saved");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Default trial days">
            <Input type="number" min={1} value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })} />
          </Field>
          <Field label="Grace period (days after renewal)">
            <Input type="number" min={0} value={form.grace_days} onChange={(e) => setForm({ ...form, grace_days: Number(e.target.value) })} />
          </Field>
          <Field label="Past-due window before suspend (days)">
            <Input type="number" min={0} value={form.past_due_days} onChange={(e) => setForm({ ...form, past_due_days: Number(e.target.value) })} />
          </Field>
          <Field label="Support session length (minutes)">
            <Input
              type="number"
              min={5}
              value={form.support_access_minutes}
              onChange={(e) => setForm({ ...form, support_access_minutes: Number(e.target.value) })}
            />
          </Field>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.support_access_enabled}
              onChange={(e) => setForm({ ...form, support_access_enabled: e.target.checked })}
            />
            Enable time-limited support access
          </label>
          <p className="text-xs text-muted">
            Off by default. When on, a Superadmin can open a read-mostly, audited session in an ISP console. They never become the owner account.
          </p>
          <p className="mt-2 text-xs font-medium tracking-wide text-muted uppercase">Public site</p>
          <Field label="Sales email">
            <Input
              type="email"
              placeholder="sales@your-domain"
              value={form.sales_email}
              onChange={(e) => setForm({ ...form, sales_email: e.target.value })}
            />
          </Field>
          <Field label="Support email">
            <Input
              type="email"
              placeholder="support@your-domain"
              value={form.support_email}
              onChange={(e) => setForm({ ...form, support_email: e.target.value })}
            />
          </Field>
          <Field label="Contact phone">
            <Input
              placeholder="Shown on the public homepage when set"
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
            />
          </Field>
          <p className="text-xs text-muted">
            These appear on the public homepage contact section. Leave blank to hide them. Enquiries from the form are stored on the platform.
          </p>
          <p className="mt-4 text-xs font-medium tracking-wide text-muted uppercase">TR-069 / ACS</p>
          <Field label="ACS public host (VPS IP or hostname)">
            <Input
              placeholder="203.0.113.10 or acs.example.com"
              value={form.acs_public_host}
              onChange={(e) => setForm({ ...form, acs_public_host: e.target.value })}
            />
          </Field>
          <Field label="Optional ACS DNS name">
            <Input
              placeholder="acs.example.com"
              value={form.acs_dns_host}
              onChange={(e) => setForm({ ...form, acs_dns_host: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Port range start">
              <Input
                type="number"
                min={1024}
                max={65535}
                value={form.acs_port_start}
                onChange={(e) => setForm({ ...form, acs_port_start: Number(e.target.value) })}
              />
            </Field>
            <Field label="Port range end">
              <Input
                type="number"
                min={1024}
                max={65535}
                value={form.acs_port_end}
                onChange={(e) => setForm({ ...form, acs_port_end: Number(e.target.value) })}
              />
            </Field>
          </div>
          <p className="text-xs text-muted">
            Each ISP gets the next free port in this range. cwmp-edge forwards those ports to the shared GenieACS CWMP. NBI stays private. Changing the range does not reassign ports already issued.
          </p>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {ok ? <p className="text-sm text-ok">{ok}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
