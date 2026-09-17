import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RouterMonitor } from "@/components/isp/router-monitor";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ROS_API_USER } from "@/lib/brand";
import { formatDateTime } from "@/lib/isp/display";
import { hasPermission } from "@/lib/isp/rbac";
import { addRouter, listRouters } from "@/lib/isp/server";
import {
  approveRouterCommand,
  getRouterApi,
  previewRouterCommand,
  queueRouterCommand,
  runRouterApi,
  saveRouterApi,
} from "@/lib/isp/server-mikrotik";
import { listAgentQueue, simulateAgentPull } from "@/lib/isp/server-ops";
import {
  copyRouterScript,
  createIpPoolFn,
  deleteIpPoolFn,
  deleteRouterFn,
  getRouterDetailFn,
  issueRouterTokenFn,
  pushRouterPoolsFn,
  reconfigureRouterFn,
  revokeRouterTokenFn,
  updateRouter,
} from "@/lib/isp/server-routers";
import { previewWorkspaceDomainFn } from "@/lib/isp/server-domains";
import { getWireGuardHub } from "@/lib/isp/server-wg";
import { cn } from "@/lib/utils";
import type { RouterRow } from "@/lib/isp/types";

export const Route = createFileRoute("/app/routers")({ component: RoutersPage });

type Detail = Awaited<ReturnType<typeof getRouterDetailFn>>;
type DomainPreview = Awaited<ReturnType<typeof previewWorkspaceDomainFn>>;
type Pool = { id: string; name: string; cidr: string };
type Notice = { tone: "ok" | "err"; text: string } | null;

const EMPTY = {
  name: "",
  identity: "",
  ros_version: "",
  model: "",
  site_pop: "",
  management_ip: "",
  role: "access",
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function RoutersPage() {
  const [rows, setRows] = useState<RouterRow[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [scriptLabel, setScriptLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const [commands, setCommands] = useState<{ id: string; router_name: string; kind: string; status: string; created_at: string }[]>([]);
  const [apiRouter, setApiRouter] = useState("");
  const [api, setApi] = useState({
    api_user: ROS_API_USER,
    api_password: "",
    api_port: 443,
    api_host: "",
    json_pull: "",
    script_pull: "",
    api_password_hint: "",
  });
  const [cmd, setCmd] = useState({
    kind: "pppoe.upsert",
    username: "",
    password: "",
    static_ip: "",
    package: "default",
    script: "",
  });
  const [preview, setPreview] = useState("");
  const [apiOut, setApiOut] = useState<string | null>(null);
  const [hubReady, setHubReady] = useState(true);
  const [role, setRole] = useState("");
  const [dateFormat, setDateFormat] = useState("dd/mm/yy");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [poolIds, setPoolIds] = useState<string[]>([]);
  const [poolForm, setPoolForm] = useState({ name: "", cidr: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmDelete, setConfirmDelete] = useState<RouterRow | null>(null);
  const [confirmReconfigure, setConfirmReconfigure] = useState<RouterRow | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [provisioningOn, setProvisioningOn] = useState(true);
  const [allowPoolPush, setAllowPoolPush] = useState(true);
  const [domainPreview, setDomainPreview] = useState<DomainPreview | null>(null);
  const [issuedMeta, setIssuedMeta] = useState<{
    source: string;
    origin: string;
    fetch_url: string;
    warning: string;
    fallback_reason: string;
  } | null>(null);

  async function load(selectId?: string) {
    const [res, q, hub, domain] = await Promise.all([
      listRouters(),
      listAgentQueue(),
      getWireGuardHub().catch(() => null),
      previewWorkspaceDomainFn().catch(() => null),
    ]);
    setRows(res.routers);
    setPools(res.pools || []);
    setProvisioningOn(res.provisioning?.enabled !== false);
    setAllowPoolPush(res.provisioning?.allow_pool_push !== false);
    setCommands(q.commands);
    setApiRouter((current) => current || res.routers[0]?.id || "");
    setHubReady(Boolean(hub?.ready));
    setRole(res.workspace.role);
    setDateFormat(res.workspace.dateFormat || "dd/mm/yy");
    if (domain) setDomainPreview(domain);
    const keep = selectId || detail?.router.id;
    if (keep && res.routers.some((r) => r.id === keep)) {
      await openDetail(keep);
    } else if (!keep && res.routers[0]) {
      await openDetail(res.routers[0].id);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) setNotice({ tone: "err", text: err instanceof Error ? err.message : "Could not load routers" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!apiRouter || !hasPermission(role, "routers.manage")) return;
    getRouterApi({ data: { router_id: apiRouter } })
      .then((info) => {
        setApi({
          api_user: info.api_user,
          api_password: info.api_password_hint,
          api_port: info.api_port,
          api_host: info.api_host,
          json_pull: info.json_pull,
          script_pull: info.script_pull,
          api_password_hint: info.api_password_hint,
        });
      })
      .catch(console.error);
  }, [apiRouter, role]);

  async function showScript(text: string, label: string, copy = true) {
    setScript(text);
    setScriptLabel(label);
    if (copy) {
      const ok = await copyText(text);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 2500);
    }
  }

  async function openDetail(id: string) {
    const next = await getRouterDetailFn({ data: { id } });
    setDetail(next);
    setPoolIds(next.assigned.map((p) => p.id));
    setPools(next.pools);
    setApiRouter(id);
    setAllowPoolPush(next.router.allow_pool_push !== false);
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (editingId) {
        const saved = await updateRouter({ data: { id: editingId, ...form, location: form.site_pop } });
        setEditingId(null);
        setForm(EMPTY);
        setAddOpen(false);
        setNotice({ tone: "ok", text: `${saved.router.name} updated` });
        await load(editingId);
        return;
      }
      const created = await addRouter({ data: { ...form, location: form.site_pop } });
      setForm(EMPTY);
      setAddOpen(false);
      const addedName = created.router?.name || form.name;
      if (created.bootstrap) {
        setIssuedMeta({
          source: created.domain_source || domainPreview?.source_label || "",
          origin: created.public_url || domainPreview?.origin || "",
          fetch_url: created.fetch_url || "",
          warning: domainPreview?.warning || "",
          fallback_reason: domainPreview?.fallback_reason || "",
        });
        setNotice({ tone: "ok", text: `${addedName} added. Paste the bootstrap script on the MikroTik.` });
        await showScript(created.bootstrap, `Bootstrap · paste on ${addedName}`);
      } else {
        setNotice({
          tone: "err",
          text: created.domain_error || "Router saved. Configure a public domain before generating a bootstrap script.",
        });
      }
      await load(created.id);
    } catch (err) {
      setNotice({ tone: "err", text: err instanceof Error ? err.message : "Could not save router" });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(r: RouterRow) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      identity: r.identity,
      ros_version: r.ros_version || "",
      model: r.model || "",
      site_pop: r.site_pop || r.location || "",
      management_ip: r.management_ip || "",
      role: r.role,
    });
    setAddOpen(true);
  }

  async function runReconfigure(r: RouterRow) {
    setBusy(true);
    setNotice(null);
    try {
      const out = await reconfigureRouterFn({ data: { id: r.id } });
      await showScript(out.bootstrap, `Re-provision · ${r.name}`);
      setNotice({ tone: "ok", text: `New bootstrap issued for ${r.name}. Previous token is no longer valid.` });
      setConfirmReconfigure(null);
      await load(r.id);
    } catch (err) {
      setNotice({ tone: "err", text: err instanceof Error ? err.message : "Reconfigure failed" });
    } finally {
      setBusy(false);
    }
  }

  const canManage = hasPermission(role, "routers.manage");
  const tenantId = detail?.workspace.tenantId || "";
  const selected = detail?.router;
  const counts = useMemo(() => {
    const awaiting = rows.filter((r) => (r.provisioning_status || "") === "awaiting_bootstrap").length;
    const online = rows.filter((r) => r.online).length;
    return { total: rows.length, awaiting, online };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Routers</h1>
          <p className="text-sm text-muted">
            MikroTik fleet for this ISP. Add a router, paste the bootstrap script, then push IP pools over the overlay.
            Online is shown only after the agent reports in.
          </p>
        </div>
        {canManage ? (
          <Button
            type="button"
            onClick={() => {
              setEditingId(null);
              setForm(EMPTY);
              setAddOpen(true);
            }}
          >
            Add router
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Routers" value={String(counts.total)} />
        <SummaryCard label="Awaiting bootstrap" value={String(counts.awaiting)} />
        <SummaryCard label="Online (evidence)" value={String(counts.online)} hint="Never claimed without last seen" />
      </div>

      {notice ? (
        <p className={cn("text-sm", notice.tone === "err" ? "text-danger" : "text-ok")}>{notice.text}</p>
      ) : null}

      {!provisioningOn ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          Router provisioning is disabled for this ISP. A platform operator can turn it back on from SaaS Management.
        </div>
      ) : null}

      {!hubReady ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          Set the hub public IP or hostname under{" "}
          <Link to="/app/settings" className="text-accent hover:underline">
            Settings → Network
          </Link>{" "}
          so the WireGuard handshake can start.
        </div>
      ) : null}

      {domainPreview ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <div className="font-medium">Bootstrap domain</div>
          {domainPreview.ok ? (
            <>
              <p className="mt-1 text-muted">
                Domain source: {domainPreview.source_label}. Certificate validation is required.
              </p>
              <p className="mt-1 font-mono text-xs">{domainPreview.origin}</p>
              <p className="mt-1 font-mono text-xs text-muted">{domainPreview.bootstrap_url_example}</p>
              {domainPreview.warning ? <p className="mt-2 text-warn">{domainPreview.warning}</p> : null}
              {domainPreview.fallback_reason ? <p className="mt-1 text-warn">{domainPreview.fallback_reason}</p> : null}
            </>
          ) : (
            <p className="mt-1 text-danger">{domainPreview.error}</p>
          )}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Router</th>
              <th className="px-4 py-3 font-medium">Site / POP</th>
              <th className="px-4 py-3 font-medium">Provisioning</th>
              <th className="px-4 py-3 font-medium">WireGuard</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
              <th className="px-4 py-3 font-medium">Pools</th>
              <th className="px-4 py-3 font-medium">Overlay</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-sm text-muted">
                  No routers yet. Add a MikroTik to generate a bootstrap script, then assign IP pools and push them.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const active = selected?.id === r.id;
              return (
                <tr key={r.id} className={cn("align-top", active && "bg-elevated/60")}>
                  <td className="px-4 py-3">
                    <button type="button" className="text-left" onClick={() => void openDetail(r.id)}>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted">
                        {r.identity}
                        {r.model ? ` · ${r.model}` : ""}
                        {r.ros_version ? ` · ROS ${r.ros_version}` : ""}
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {r.site_pop || r.location || "—"}
                    {r.management_ip ? <div className="font-mono text-xs text-muted">{r.management_ip}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(r.provisioning_status || "pending")}>
                      {(r.provisioning_status || "pending").replaceAll("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(r.reachability || r.wg_status)}>{r.reachability || r.wg_status}</Badge>
                    {r.online ? (
                      <div className="mt-1 text-xs text-ok">Evidence: agent seen</div>
                    ) : (
                      <div className="mt-1 text-xs text-muted">Not claimed online</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{formatDateTime(r.last_seen, dateFormat)}</td>
                  <td className="px-4 py-3 text-xs">{r.pool_count ?? 0}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.wg_address || "—"}</td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void openDetail(r.id)}>
                          Details
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => startEdit(r)}>
                          Update
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmReconfigure(r)}>
                          Reconfigure
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}>
                          Delete
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => void openDetail(r.id)}>
                        View
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
          <div>
            <h2 className="font-medium">IP pools</h2>
            <p className="text-sm text-muted">
              Create pools for this ISP, assign them to the selected router, then push `/ip pool` to the agent.
              {selected ? ` Selected: ${selected.name}` : " Select a router to push."}
            </p>
          </div>
          {canManage ? (
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setNotice(null);
                try {
                  const created = await createIpPoolFn({ data: poolForm });
                  setPoolForm({ name: "", cidr: "" });
                  setNotice({ tone: "ok", text: `Pool ${created.name} created (${created.ranges})` });
                  await load(selected?.id);
                  setPoolIds((cur) => (cur.includes(created.id) ? cur : [...cur, created.id]));
                } catch (err) {
                  setNotice({ tone: "err", text: err instanceof Error ? err.message : "Could not create pool" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Pool name">
                <Input
                  required
                  value={poolForm.name}
                  onChange={(e) => setPoolForm({ ...poolForm, name: e.target.value })}
                  placeholder="Nanyuki PPPoE"
                />
              </Field>
              <Field label="CIDR">
                <Input
                  required
                  value={poolForm.cidr}
                  onChange={(e) => setPoolForm({ ...poolForm, cidr: e.target.value })}
                  placeholder="10.10.10.0/24"
                />
              </Field>
              <div className="flex items-end">
                <Button type="submit" size="sm" disabled={busy}>
                  Add pool
                </Button>
              </div>
            </form>
          ) : null}

          <div className="space-y-2">
            {pools.length === 0 ? <p className="text-sm text-muted">No IP pools yet. Add a CIDR above.</p> : null}
            {pools.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!selected || !canManage}
                    checked={poolIds.includes(p.id)}
                    onChange={(e) => {
                      setPoolIds((cur) => (e.target.checked ? [...cur, p.id] : cur.filter((id) => id !== p.id)));
                    }}
                  />
                  <span className="truncate">
                    {p.name} <span className="font-mono text-xs text-muted">{p.cidr}</span>
                  </span>
                </label>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await deleteIpPoolFn({ data: { id: p.id } });
                        setPoolIds((cur) => cur.filter((id) => id !== p.id));
                        await load(selected?.id);
                      } catch (err) {
                        setNotice({ tone: "err", text: err instanceof Error ? err.message : "Could not delete pool" });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {canManage && selected ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || !allowPoolPush}
                onClick={async () => {
                  setBusy(true);
                  setNotice(null);
                  try {
                    await pushRouterPoolsFn({ data: { id: selected.id, pool_ids: poolIds, push: true } });
                    setNotice({ tone: "ok", text: `Pools pushed to ${selected.name}. The agent applies them on the next pull.` });
                    await load(selected.id);
                  } catch (err) {
                    setNotice({ tone: "err", text: err instanceof Error ? err.message : "Pool push failed" });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save and push pools
              </Button>
              {!allowPoolPush ? <p className="text-xs text-muted">Pool push is disabled for this ISP.</p> : null}
            </div>
          ) : null}
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
          <div>
            <h2 className="font-medium">{selected ? selected.name : "Router details"}</h2>
            <p className="text-sm text-muted">
              {selected
                ? `${selected.identity} · ${selected.site_pop || "no site"} · tenant ${tenantId}`
                : "Select a router in the list."}
            </p>
          </div>
          {selected ? (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Provisioning</dt>
                  <dd>
                    <Badge tone={statusTone(selected.provisioning_status)}>
                      {selected.provisioning_status.replaceAll("_", " ")}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">WireGuard</dt>
                  <dd>
                    <Badge tone={statusTone(selected.reachability)}>{selected.reachability}</Badge>
                    <div className="mt-1 text-xs text-muted">
                      {selected.online ? "Agent heartbeat or pull received" : "No connectivity evidence yet"}
                    </div>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Model / ROS</dt>
                  <dd>
                    {selected.model || "—"} · {selected.ros_version || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Management IP</dt>
                  <dd className="font-mono text-xs">{selected.management_ip || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Overlay</dt>
                  <dd className="font-mono text-xs">{selected.wg_address || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Hub</dt>
                  <dd className="font-mono text-xs">
                    {selected.hub.ready ? `${selected.hub.endpoint_host}:${selected.hub.listen_port}` : "Not set"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Last seen</dt>
                  <dd className="font-mono text-xs">{formatDateTime(selected.last_seen, dateFormat)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Token</dt>
                  <dd className="text-xs">
                    {selected.token.live
                      ? `Live · …${selected.token.hint} · expires ${formatDateTime(selected.token.expires_at, dateFormat)}`
                      : selected.token.revoked
                        ? "Revoked"
                        : "None live — generate bootstrap"}
                  </dd>
                </div>
              </dl>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={!domainPreview?.ok}
                    onClick={async () => {
                      try {
                        const out = await issueRouterTokenFn({ data: { id: selected.id } });
                        setIssuedMeta({
                          source: out.domain_source_label || domainPreview?.source_label || "",
                          origin: out.public_url || domainPreview?.origin || "",
                          fetch_url: out.fetch_url || "",
                          warning: out.warning || domainPreview?.warning || "",
                          fallback_reason: out.fallback_reason || domainPreview?.fallback_reason || "",
                        });
                        await showScript(out.bootstrap, `Bootstrap · ${selected.name}`);
                        await load(selected.id);
                      } catch (err) {
                        setNotice({
                          tone: "err",
                          text: err instanceof Error ? err.message : "Could not generate bootstrap",
                        });
                      }
                    }}
                  >
                    Generate bootstrap
                  </Button>
                  {!domainPreview?.ok && domainPreview?.error ? (
                    <p className="basis-full text-xs text-danger">{domainPreview.error}</p>
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await revokeRouterTokenFn({ data: { id: selected.id } });
                      setNotice({ tone: "ok", text: "Provisioning token revoked" });
                      await load(selected.id);
                    }}
                  >
                    Revoke token
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirmReconfigure(rows.find((r) => r.id === selected.id) || null)}>
                    Reconfigure
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const out = await copyRouterScript({ data: { id: selected.id } });
                      await showScript(out.script, `Full enroll · ${selected.name}`, false);
                    }}
                  >
                    Copy enroll
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const pull = await simulateAgentPull({ data: { router_id: selected.id } });
                      await showScript(pull.script, `Agent pull · ${selected.name}`, false);
                      await load(selected.id);
                    }}
                  >
                    Agent pull
                  </Button>
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-sm font-medium">Configuration versions</h3>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {(detail?.history || []).length === 0 ? <li className="px-3 py-3 text-sm text-muted">None yet</li> : null}
                  {(detail?.history || []).map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span>
                        v{v.version} · {v.kind}
                        <span className="ml-2 font-mono text-xs text-muted">{v.checksum.slice(0, 8)}</span>
                      </span>
                      <span className="text-xs text-muted">{formatDateTime(v.created_at, dateFormat)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Provisioning log</h3>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {(detail?.events || []).length === 0 ? <li className="px-3 py-3 text-sm text-muted">No events</li> : null}
                  {(detail?.events || []).map((ev) => (
                    <li key={ev.id} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{ev.event.replaceAll("_", " ")}</span>
                        <span className="text-xs text-muted">{formatDateTime(ev.created_at, dateFormat)}</span>
                      </div>
                      {ev.detail && ev.detail !== "{}" ? (
                        <pre className="mt-1 overflow-x-auto text-xs text-muted">{ev.detail}</pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </section>
      </div>

      <Dialog
        open={Boolean(script)}
        onOpenChange={(open) => {
          if (!open) {
            setScript(null);
            setIssuedMeta(null);
          }
        }}
        title={scriptLabel || "RouterOS v7 script"}
        description="Paste in New Terminal. Certificate validation stays on."
        className="sm:max-w-2xl"
      >
        <div className="space-y-3">
          {issuedMeta || domainPreview?.ok ? (
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Domain source</dt>
                <dd>{issuedMeta?.source || domainPreview?.source_label}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Public URL</dt>
                <dd className="font-mono text-xs">{issuedMeta?.origin || domainPreview?.origin}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Bootstrap URL</dt>
                <dd className="break-all font-mono text-xs">
                  {issuedMeta?.fetch_url || domainPreview?.bootstrap_url_example}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Certificate validation</dt>
                <dd>Required</dd>
              </div>
            </dl>
          ) : domainPreview?.error ? (
            <p className="text-sm text-danger">{domainPreview.error}</p>
          ) : null}
          {issuedMeta?.warning || domainPreview?.warning ? (
            <p className="text-sm text-warn">{issuedMeta?.warning || domainPreview?.warning}</p>
          ) : null}
          {issuedMeta?.fallback_reason ? <p className="text-sm text-warn">{issuedMeta.fallback_reason}</p> : null}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                if (!script) return;
                const ok = await copyText(script);
                setCopied(ok);
              }}
            >
              {copied ? "Copied" : "Copy script"}
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg">
            {script}
          </pre>
        </div>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={editingId ? "Update router" : "Add MikroTik router"}
        description="Name, identity, and site are used in the generated configuration. A unique provisioning token is created on add."
        className="sm:max-w-xl"
      >
        <form onSubmit={submitAdd} className="grid gap-3 sm:grid-cols-2">
          <Field label="Router name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Identity">
            <Input value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} placeholder="Same as name if empty" />
          </Field>
          <Field label="RouterOS version">
            <Input value={form.ros_version} onChange={(e) => setForm({ ...form, ros_version: e.target.value })} placeholder="7.16" />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="RB5009" />
          </Field>
          <Field label="Site / POP">
            <Input value={form.site_pop} onChange={(e) => setForm({ ...form, site_pop: e.target.value })} />
          </Field>
          <Field label="Management IP">
            <Input value={form.management_ip} onChange={(e) => setForm({ ...form, management_ip: e.target.value })} placeholder="Overlay or LAN, not WAN API" />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="core">Core</option>
              <option value="edge">Edge</option>
              <option value="access">Access</option>
              <option value="hotspot">Hotspot</option>
            </Select>
          </Field>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {editingId ? "Save" : "Add and generate bootstrap"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title="Delete router"
        description={confirmDelete ? `Remove ${confirmDelete.name} and its provisioning tokens, versions, and pool assignments.` : undefined}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (!confirmDelete) return;
              setBusy(true);
              try {
                await deleteRouterFn({ data: { id: confirmDelete.id } });
                if (detail?.router.id === confirmDelete.id) setDetail(null);
                setConfirmDelete(null);
                await load();
              } catch (err) {
                setNotice({ tone: "err", text: err instanceof Error ? err.message : "Could not delete" });
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(confirmReconfigure)}
        onOpenChange={(open) => {
          if (!open) setConfirmReconfigure(null);
        }}
        title="Reconfigure router"
        description={
          confirmReconfigure
            ? `Issue a new bootstrap token for ${confirmReconfigure.name} and queue assigned IP pools. The previous token stops working.`
            : undefined
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              if (confirmReconfigure) void runReconfigure(confirmReconfigure);
            }}
          >
            Reconfigure
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmReconfigure(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      {apiRouter && (hasPermission(role, "traffic.view") || hasPermission(role, "routers.read")) ? (
        <RouterMonitor routerId={apiRouter} />
      ) : null}

      {canManage ? (
        <div className="space-y-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? "Hide agent queue and RouterOS API" : "Show agent queue and RouterOS API"}
          </Button>
          {advanced ? (
            <>
              <form
                className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!apiRouter) return;
                  setApiOut(null);
                  await saveRouterApi({
                    data: {
                      router_id: apiRouter,
                      api_user: api.api_user,
                      api_password: api.api_password,
                      api_port: Number(api.api_port) || 443,
                      api_host: api.api_host,
                    },
                  });
                  setApiOut("RouterOS API credentials saved. Agent still pulls over WireGuard; REST is optional for a jump host.");
                }}
              >
                <h2 className="md:col-span-2 font-medium">MikroTik API</h2>
                <p className="md:col-span-2 text-sm text-muted">
                  Commands compile to RouterOS v7 REST and a .rsc script. The router agent pulls them with the enroll token —
                  the SaaS never needs the WAN API port open.
                </p>
                <Field label="Router">
                  <Select
                    value={apiRouter}
                    onChange={async (e) => {
                      const id = e.target.value;
                      setApiRouter(id);
                      if (!id) return;
                      const info = await getRouterApi({ data: { router_id: id } });
                      setApi({
                        api_user: info.api_user,
                        api_password: info.api_password_hint,
                        api_port: info.api_port,
                        api_host: info.api_host,
                        json_pull: info.json_pull,
                        script_pull: info.script_pull,
                        api_password_hint: info.api_password_hint,
                      });
                    }}
                  >
                    <option value="">Select</option>
                    {rows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="API user">
                  <Input value={api.api_user} onChange={(e) => setApi({ ...api, api_user: e.target.value })} />
                </Field>
                <Field label="API password">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={api.api_password_hint || "REST / www-ssl user"}
                    value={api.api_password}
                    onChange={(e) => setApi({ ...api, api_password: e.target.value })}
                  />
                </Field>
                <Field label="REST port">
                  <Input
                    value={String(api.api_port)}
                    onChange={(e) => setApi({ ...api, api_port: Number(e.target.value) || 443 })}
                  />
                </Field>
                <Field label="API host (optional jump)">
                  <Input
                    placeholder="Leave empty — agent executes locally"
                    value={api.api_host}
                    onChange={(e) => setApi({ ...api, api_host: e.target.value })}
                  />
                </Field>
                <Field label="JSON pull URL">
                  <Input readOnly value={api.json_pull || "Set public site URL in Settings"} />
                </Field>
                <Field label="RouterOS script pull URL">
                  <Input readOnly value={api.script_pull || "Set public site URL in Settings"} />
                </Field>
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  <Button type="submit">Save API</Button>
                </div>
                {apiOut ? <p className="md:col-span-2 text-sm text-accent">{apiOut}</p> : null}

                <h3 className="md:col-span-2 mt-2 text-sm font-medium">Queue a command</h3>
                <Field label="Kind">
                  <Select value={cmd.kind} onChange={(e) => setCmd({ ...cmd, kind: e.target.value })}>
                    <option value="pppoe.upsert">PPPoE upsert (secret)</option>
                    <option value="pppoe.disable">PPPoE disable + kick</option>
                    <option value="static.upsert">Static queue + address-list</option>
                    <option value="static.disable">Static disable</option>
                    <option value="hotspot.upsert">Hotspot user upsert</option>
                    <option value="hotspot.disable">Hotspot disable + kick</option>
                    <option value="identity.set">Set identity</option>
                    <option value="resource.snapshot">System resource</option>
                  </Select>
                </Field>
                <Field label="Username / identity">
                  <Input value={cmd.username} onChange={(e) => setCmd({ ...cmd, username: e.target.value })} />
                </Field>
                <Field label="Password">
                  <Input value={cmd.password} onChange={(e) => setCmd({ ...cmd, password: e.target.value })} />
                </Field>
                <Field label="Static IP">
                  <Input value={cmd.static_ip} onChange={(e) => setCmd({ ...cmd, static_ip: e.target.value })} />
                </Field>
                <Field label="Profile / package">
                  <Input value={cmd.package} onChange={(e) => setCmd({ ...cmd, package: e.target.value })} />
                </Field>
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      const p = await previewRouterCommand({
                        data: {
                          kind: cmd.kind,
                          payload: {
                            username: cmd.username,
                            name: cmd.username,
                            identity: cmd.username,
                            password: cmd.password,
                            static_ip: cmd.static_ip,
                            package: cmd.package,
                            script: cmd.script,
                          },
                          host: api.api_host,
                          user: api.api_user,
                        },
                      });
                      setPreview(`${p.script}\n\n${p.curl || JSON.stringify(p.rest, null, 2)}`);
                    }}
                  >
                    Preview REST / script
                  </Button>
                  <Button
                    type="button"
                    onClick={async () => {
                      if (!apiRouter) return;
                      const q = await queueRouterCommand({
                        data: {
                          router_id: apiRouter,
                          kind: cmd.kind,
                          payload: {
                            username: cmd.username,
                            name: cmd.username,
                            identity: cmd.username,
                            password: cmd.password,
                            static_ip: cmd.static_ip,
                            package: cmd.package,
                            script: cmd.script,
                          },
                        },
                      });
                      setPreview(q.script);
                      setApiOut(`Queued ${q.id}`);
                      await load();
                    }}
                  >
                    Queue for agent
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      if (!apiRouter) return;
                      const r = await runRouterApi({
                        data: {
                          router_id: apiRouter,
                          kind: cmd.kind,
                          payload: {
                            username: cmd.username,
                            name: cmd.username,
                            identity: cmd.username,
                            password: cmd.password,
                            static_ip: cmd.static_ip,
                            package: cmd.package,
                            script: cmd.script,
                          },
                        },
                      });
                      setPreview(JSON.stringify(r, null, 2));
                      setApiOut(r.simulated ? "Simulated (no API host)" : "REST executed");
                    }}
                  >
                    Run REST now
                  </Button>
                </div>
                {preview ? (
                  <pre className="md:col-span-2 overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg">
                    {preview}
                  </pre>
                ) : null}
              </form>

              <section>
                <h2 className="mb-3 font-medium">Agent command queue</h2>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {commands.length === 0 ? (
                    <li className="px-4 py-6 text-sm text-muted">No commands yet. Provision or suspend a service.</li>
                  ) : null}
                  {commands.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 bg-surface px-4 py-3 text-sm">
                      <div>
                        <span className="font-mono text-xs">{c.kind}</span>
                        <div className="text-xs text-muted">{c.router_name}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.status === "proposed" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              await approveRouterCommand({ data: { id: c.id } });
                              await load();
                            }}
                          >
                            Approve
                          </Button>
                        ) : null}
                        <Badge tone={statusTone(c.status === "acked" ? "active" : "pending")}>{c.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
