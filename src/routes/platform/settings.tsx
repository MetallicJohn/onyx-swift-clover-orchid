import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHead, Panel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
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
    acs_tls: "http" as "http" | "https",
    acs_require_cpe_auth: true,
    acs_lock_url: true,
    acs_provision_service: true,
    traffic_enabled: true,
    traffic_interval_sec: 30,
    traffic_router_interval_sec: 60,
    traffic_short_hours: 24,
    traffic_hourly_days: 90,
    traffic_daily_days: 730,
    traffic_source_priority: "radius,routeros,snmp,netflow",
    app_public_url: "",
    tenant_subdomain_base: "",
    central_domain_only: false,
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
          <p className="mt-2 text-xs font-medium tracking-wide text-muted uppercase">Public domain</p>
          <p className="text-xs text-muted">
            Router bootstrap and customer links use this central origin unless an ISP has a verified subdomain or custom domain.{" "}
            <Link to="/platform/domains" className="text-accent hover:underline">
              Open Domains
            </Link>
          </p>
          <Field label="Public application URL">
            <Input
              placeholder="https://isp.example.com"
              value={form.app_public_url}
              onChange={(e) => setForm({ ...form, app_public_url: e.target.value })}
            />
          </Field>
          <Field label="Tenant subdomain base">
            <Input
              placeholder="isp.example.com"
              value={form.tenant_subdomain_base}
              onChange={(e) => setForm({ ...form, tenant_subdomain_base: e.target.value })}
            />
          </Field>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.central_domain_only}
              onChange={(e) => setForm({ ...form, central_domain_only: e.target.checked })}
            />
            Central-domain-only mode
          </label>
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
            Each ISP gets the next free port in this range. The TR-069 edge forwards those ports to the shared ACS. The
            northbound API stays private. Changing the range does not reassign ports already issued.
          </p>
          <Field label="ACS URL scheme">
            <Select
              value={form.acs_tls}
              onChange={(e) => setForm({ ...form, acs_tls: e.target.value === "https" ? "https" : "http" })}
            >
              <option value="http">HTTP (default — existing OLT profiles keep working)</option>
              <option value="https">HTTPS (issue https:// ACS URLs)</option>
            </Select>
          </Field>
          {form.acs_tls === "https" ? (
            <p className="text-xs text-muted">
              ONUs keep the old URL until the OLT TR-069 profile is updated. Put a TLS certificate for this ACS host on
              the TR-069 edge before switching.
            </p>
          ) : (
            <p className="text-xs text-muted">
              HTTP is the safe default while OLT profiles already use http://. Switch to HTTPS after the edge has a
              certificate.
            </p>
          )}
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.acs_require_cpe_auth}
              onChange={(e) => setForm({ ...form, acs_require_cpe_auth: e.target.checked })}
            />
            <span>Require CPE digest login (each ISP's ACS username and password)</span>
          </label>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.acs_lock_url}
              onChange={(e) => setForm({ ...form, acs_lock_url: e.target.checked })}
            />
            <span>Lock ACS URL on inform (rewrite the ONU if it is redirected)</span>
          </label>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.acs_provision_service}
              onChange={(e) => setForm({ ...form, acs_provision_service: e.target.checked })}
            />
            <span>Provision WAN, SSID, and Wi-Fi password from the assigned service on inform</span>
          </label>
          <p className="mt-4 text-xs font-medium tracking-wide text-muted uppercase">Traffic monitoring</p>
          <p className="text-xs text-muted">
            Realtime rates stay in Redis. PostgreSQL only stores minute/hourly/daily aggregates. Billing still uses RADIUS
            accounting — not these samples.
          </p>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.traffic_enabled}
              onChange={(e) => setForm({ ...form, traffic_enabled: e.target.checked })}
            />
            Enable traffic collectors
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Realtime interval (seconds)">
              <Input
                type="number"
                min={5}
                max={300}
                value={form.traffic_interval_sec}
                onChange={(e) => setForm({ ...form, traffic_interval_sec: Number(e.target.value) })}
              />
            </Field>
            <Field label="Router poll interval (seconds)">
              <Input
                type="number"
                min={15}
                max={600}
                value={form.traffic_router_interval_sec}
                onChange={(e) => setForm({ ...form, traffic_router_interval_sec: Number(e.target.value) })}
              />
            </Field>
            <Field label="Short-term retention (hours)">
              <Input
                type="number"
                min={1}
                max={168}
                value={form.traffic_short_hours}
                onChange={(e) => setForm({ ...form, traffic_short_hours: Number(e.target.value) })}
              />
            </Field>
            <Field label="Hourly retention (days)">
              <Input
                type="number"
                min={7}
                max={730}
                value={form.traffic_hourly_days}
                onChange={(e) => setForm({ ...form, traffic_hourly_days: Number(e.target.value) })}
              />
            </Field>
            <Field label="Daily retention (days)">
              <Input
                type="number"
                min={30}
                max={3650}
                value={form.traffic_daily_days}
                onChange={(e) => setForm({ ...form, traffic_daily_days: Number(e.target.value) })}
              />
            </Field>
            <Field label="Source priority">
              <Input
                value={form.traffic_source_priority}
                onChange={(e) => setForm({ ...form, traffic_source_priority: e.target.value })}
              />
            </Field>
          </div>
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
