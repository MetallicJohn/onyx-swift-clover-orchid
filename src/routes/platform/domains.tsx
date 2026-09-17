import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHead, Panel, StatusPill } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { domainStatusLabel, httpsStatusLabel, dnsStatusLabel } from "@/lib/isp/domain-format";
import {
  disableDomainFn,
  enableDomainFn,
  generateSubdomainFn,
  getDomainDeskFn,
  removeDomainFn,
  revokeDomainFn,
  saveCentralDomainFn,
  setCustomDomainFn,
  setDomainPrimaryFn,
  testDomainUrlFn,
  verifyDomainDnsFn,
  verifyDomainHttpsFn,
} from "@/lib/isp/server-domains";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/platform/domains")({ component: DomainsPage });

type Desk = Awaited<ReturnType<typeof getDomainDeskFn>>;
type TenantRow = Desk["tenants"][number];
type DomainRow = Desk["domains"][number];

function DomainsPage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [central, setCentral] = useState({ app_public_url: "", tenant_subdomain_base: "", central_domain_only: false });
  const [selected, setSelected] = useState<TenantRow | null>(null);
  const [customHost, setCustomHost] = useState("");
  const [detail, setDetail] = useState<DomainRow | null>(null);
  const [testOut, setTestOut] = useState<string | null>(null);

  async function load() {
    const next = await getDomainDeskFn();
    setDesk(next);
    setCentral({
      app_public_url: next.central.app_public_url || next.central.origin,
      tenant_subdomain_base: next.central.tenant_subdomain_base,
      central_domain_only: next.central.central_domain_only,
    });
    if (selected) {
      setSelected(next.tenants.find((t) => t.tenant_id === selected.tenant_id) || null);
    }
    return next;
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load domains"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tenantDomains = useMemo(() => {
    if (!desk || !selected) return [];
    return desk.domains.filter((d) => d.tenant_id === selected.tenant_id);
  }, [desk, selected]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const result = await fn();
      if (result && typeof result === "object" && "desk" in result) {
        const next = (result as { desk: Desk }).desk;
        setDesk(next);
        setCentral({
          app_public_url: next.central.app_public_url || next.central.origin,
          tenant_subdomain_base: next.central.tenant_subdomain_base,
          central_domain_only: next.central.central_domain_only,
        });
        if (selected) setSelected(next.tenants.find((t) => t.tenant_id === selected.tenant_id) || null);
      } else {
        await load();
      }
      setOk(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (error && !desk) return <p className="text-sm text-danger">{error}</p>;
  if (!desk) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;

  return (
    <div>
      <PageHead
        eyebrow="Platform"
        title="Domains"
        hint={`${APP_NAME} never invents a hostname. Router bootstrap, customer portal, and payment callbacks use a verified custom domain, a verified tenant subdomain, or the central application domain.`}
      />

      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
      {ok ? <p className="mb-4 text-sm text-ok">{ok}</p> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <h2 className="mb-1 text-base font-medium">Central application domain</h2>
          <p className="mb-4 text-sm text-muted">
            Default public origin for every ISP. Used when a tenant subdomain or custom domain is missing or not verified.
          </p>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => saveCentralDomainFn({ data: central }), "Central domain saved");
            }}
          >
            <Field label="Public application URL">
              <Input
                placeholder="https://isp.example.com"
                value={central.app_public_url}
                onChange={(e) => setCentral({ ...central, app_public_url: e.target.value })}
              />
            </Field>
            <Field label="Tenant subdomain base">
              <Input
                placeholder="isp.example.com"
                value={central.tenant_subdomain_base}
                onChange={(e) => setCentral({ ...central, tenant_subdomain_base: e.target.value })}
              />
            </Field>
            <label className="flex h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={central.central_domain_only}
                onChange={(e) => setCentral({ ...central, central_domain_only: e.target.checked })}
              />
              Central-domain-only mode
            </label>
            <p className="text-xs text-muted">
              Source: {desk.central.source.replace("_", " ")}
              {desk.central.production ? " · production" : " · preview"}
              {desk.central.origin ? ` · active ${desk.central.origin}` : " · not configured"}
            </p>
            <Button type="submit" disabled={busy}>
              Save central domain
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !central.app_public_url}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const out = await testDomainUrlFn({ data: { origin: central.app_public_url } });
                  setOk(out.ok ? `Central URL reachable · HTTPS ${out.status_code ?? ""}` : out.error || "Unreachable");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not test URL");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Test public URL
            </Button>
          </form>
        </Panel>

        <Panel className="lg:col-span-2">
          <h2 className="mb-1 text-base font-medium">Active origin</h2>
          <p className="mb-4 text-sm text-muted">
            Priority is verified custom domain, then verified tenant subdomain, then this central domain. Unverified names are never selected.
          </p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Central origin</dt>
              <dd className="font-mono text-xs">{desk.central.origin || "Not configured"}</dd>
            </div>
            <div>
              <dt className="text-muted">HTTPS</dt>
              <dd>{desk.central.origin?.startsWith("https://") ? "Required" : desk.central.origin ? "Not HTTPS" : "—"}</dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel className="mt-6 overflow-x-auto">
        <h2 className="mb-4 text-base font-medium">ISP domains</h2>
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">ISP</th>
              <th className="px-3 py-2 font-medium">Slug</th>
              <th className="px-3 py-2 font-medium">Subdomain</th>
              <th className="px-3 py-2 font-medium">Custom</th>
              <th className="px-3 py-2 font-medium">DNS</th>
              <th className="px-3 py-2 font-medium">HTTPS</th>
              <th className="px-3 py-2 font-medium">Active origin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {desk.tenants.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-muted">
                  No ISPs yet.
                </td>
              </tr>
            ) : null}
            {desk.tenants.map((t) => {
              const active = selected?.tenant_id === t.tenant_id;
              return (
                <tr key={t.tenant_id} className={cn(active && "bg-elevated/60")}>
                  <td className="px-3 py-3">
                    <button type="button" className="text-left font-medium" onClick={() => setSelected(t)}>
                      {t.name}
                    </button>
                    <div className="text-xs text-muted">
                      <Link className="text-accent hover:underline" to="/platform/tenants/$tenantId" params={{ tenantId: t.tenant_id }}>
                        Open ISP
                      </Link>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{t.slug}</td>
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs">{t.subdomain_hostname || "—"}</div>
                    {t.subdomain_status ? <StatusPill status={t.subdomain_status} /> : null}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs">{t.custom_hostname || "—"}</div>
                    {t.custom_status ? <StatusPill status={t.custom_status} /> : null}
                  </td>
                  <td className="px-3 py-3">{t.dns_status ? <StatusPill status={t.dns_status} /> : "—"}</td>
                  <td className="px-3 py-3">{t.https_status ? <StatusPill status={t.https_status} /> : "—"}</td>
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs">{t.active_origin || "None"}</div>
                    <div className="text-xs text-muted">{t.active_source || t.warning}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {selected ? (
        <Panel className="mt-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-medium">{selected.name}</h2>
              <p className="text-sm text-muted">
                Active: {selected.active_origin || "none"} · {selected.active_source || "not resolved"}
              </p>
              {selected.warning ? <p className="mt-1 text-sm text-warn">{selected.warning}</p> : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => generateSubdomainFn({ data: { tenant_id: selected.tenant_id } }), "Subdomain generated")}
            >
              Generate subdomain
            </Button>
          </div>

          <form
            className="mb-6 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => setCustomDomainFn({ data: { tenant_id: selected.tenant_id, hostname: customHost } }),
                "Custom domain added — verify DNS then HTTPS before it is used",
              );
              setCustomHost("");
            }}
          >
            <Field label="Custom domain">
              <Input
                placeholder="portal.imaninetworks.co.ke"
                value={customHost}
                onChange={(e) => setCustomHost(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy || !customHost.trim()}>
              Set custom domain
            </Button>
          </form>

          <div className="grid gap-3">
            {tenantDomains.length === 0 ? (
              <p className="text-sm text-muted">No subdomain or custom domain yet. Central application domain is used.</p>
            ) : null}
            {tenantDomains.map((d) => (
              <div key={d.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {d.kind_label} · <span className="font-mono text-sm">{d.hostname}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <StatusPill status={d.domain_status} />
                      <span className="text-muted">DNS {dnsStatusLabel(d.dns_status)}</span>
                      <span className="text-muted">HTTPS {httpsStatusLabel(d.https_status)}</span>
                      {d.is_primary ? <span className="text-ok">Primary</span> : null}
                    </div>
                    {d.last_error ? <p className="mt-2 text-sm text-danger">{d.last_error}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDetail(d)}>
                      Details
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void run(() => verifyDomainDnsFn({ data: { domain_id: d.id } }), "DNS check finished")}
                    >
                      {d.dns_status === "pending" ? "Verify DNS" : "Recheck DNS"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void run(() => verifyDomainHttpsFn({ data: { domain_id: d.id } }), "HTTPS check finished")}
                    >
                      {d.https_status === "pending" ? "Verify HTTPS" : "Recheck HTTPS"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !d.usable}
                      onClick={() => void run(() => setDomainPrimaryFn({ data: { domain_id: d.id } }), "Primary domain updated")}
                    >
                      Set primary
                    </Button>
                    {d.domain_status === "disabled" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void run(() => enableDomainFn({ data: { domain_id: d.id } }), "Domain enabled")}
                      >
                        Re-enable
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void run(() => disableDomainFn({ data: { domain_id: d.id } }), "Domain disabled")}
                      >
                        Disable
                      </Button>
                    )}
                    {d.kind === "custom" ? (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => void run(() => removeDomainFn({ data: { domain_id: d.id } }), "Custom domain removed")}
                      >
                        Remove
                      </Button>
                    ) : null}
                    {d.domain_status !== "revoked" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void run(() => revokeDomainFn({ data: { domain_id: d.id } }), "Domain revoked")}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
            setTestOut(null);
          }
        }}
        title={detail ? detail.hostname : "Domain"}
        description={detail ? `${detail.kind_label} · ${domainStatusLabel(detail.domain_status)}` : undefined}
      >
        {detail ? (
          <div className="space-y-3 text-sm">
            <p>
              Create a TXT record at <span className="font-mono text-xs">{detail.verification_txt_name}</span> with value{" "}
              <span className="font-mono text-xs">{detail.verification_txt_expected}</span>, or point CNAME/A at the central host.
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted">Certificate</dt>
                <dd>{detail.certificate_subject || "Not checked"}</dd>
              </div>
              <div>
                <dt className="text-muted">Expires</dt>
                <dd className="font-mono text-xs">{detail.certificate_expires_at || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Last check</dt>
                <dd className="font-mono text-xs">{detail.last_checked_at || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Attempts</dt>
                <dd>{detail.verification_attempts}</dd>
              </div>
            </dl>
            {testOut ? <p className="text-sm">{testOut}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const out = await testDomainUrlFn({ data: { domain_id: detail.id } });
                    setTestOut(out.ok ? `Reachable · HTTPS ${out.status_code ?? ""}` : out.error || "Unreachable");
                  } catch (err) {
                    setTestOut(err instanceof Error ? err.message : "Test failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Test public URL
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
