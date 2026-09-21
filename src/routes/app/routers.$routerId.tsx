import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { RouterMonitor } from "@/components/isp/router-monitor";
import { RosScriptDialog, type RosScriptPack, primaryScript } from "@/components/isp/ros-script-dialog";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { formatDateTime } from "@/lib/isp/display";
import { hasPermission } from "@/lib/isp/rbac";
import type { RouterPoolRow } from "@/lib/isp/router-desk";
import { getRouterApi, saveRouterApi } from "@/lib/isp/server-mikrotik";
import { hubPeerShell } from "@/lib/isp/wg-peer-shell";
import {
  archiveRouterFn,
  archiveRouterPoolFn,
  copyRouterScript,
  copyRouterApiUser,
  createRouterPoolFn,
  getRouterDeskFn,
  issueRouterTokenFn,
  listRouterPoolAssignmentsFn,
  reconfigureRouterFn,
  regenerateRouterAgentFn,
  repairRouterConnectionFn,
  revokeRouterTokenFn,
  rotateRouterApiFn,
  rotateRouterWireGuardFn,
  setPoolEnabledFn,
  setRouterEnabledFn,
  testRouterConnectionFn,
  updateRouter,
  updateRouterPoolFn,
} from "@/lib/isp/server-routers";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/copy-text";

type Search = { tab?: "pools" | "monitoring"; action?: "edit" };

export const Route = createFileRoute("/app/routers/$routerId")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    tab: search.tab === "pools" || search.tab === "monitoring" ? search.tab : undefined,
    action: search.action === "edit" ? "edit" : undefined,
  }),
  component: RouterRecordPage,
});

type RecordData = Awaited<ReturnType<typeof getRouterDeskFn>>;

const EMPTY_POOL = {
  name: "",
  code: "",
  cidr: "",
  gateway: "",
  first_ip: "",
  last_ip: "",
  access_type: "pppoe",
  vlan_id: "",
  site_pop: "",
  description: "",
  dns_servers: "",
  status: "active",
};

function RouterRecordPage() {
  const { routerId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [data, setData] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(search.action === "edit");
  const [form, setForm] = useState({
    name: "",
    identity: "",
    ros_version: "",
    model: "",
    site_pop: "",
    management_ip: "",
    role: "access",
  });
  const [poolForm, setPoolForm] = useState(EMPTY_POOL);
  const [poolOpen, setPoolOpen] = useState(false);
  const [editingPool, setEditingPool] = useState<RouterPoolRow | null>(null);
  const [confirmImpact, setConfirmImpact] = useState(false);
  const [usagePool, setUsagePool] = useState<RouterPoolRow | null>(null);
  const [assignments, setAssignments] = useState<{ customer_name: string; address: string; status: string; username: string | null }[]>([]);
  const [removePool, setRemovePool] = useState<RouterPoolRow | null>(null);
  const [showMonitoring, setShowMonitoring] = useState(search.tab === "monitoring");
  const [pack, setPack] = useState<RosScriptPack | null>(null);
  const [copiedBtn, setCopiedBtn] = useState<string | null>(null);
  const [confirmSync, setConfirmSync] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [probe, setProbe] = useState<Awaited<ReturnType<typeof testRouterConnectionFn>> | null>(null);
  const [apiForm, setApiForm] = useState({
    api_user: "ispsolutions-agent",
    api_password: "",
    api_port: 443,
    api_host: "",
    api_password_set: false,
    api_password_hint: "",
  });

  async function openPack(next: RosScriptPack, btn: string) {
    setPack(next);
    const first = primaryScript(next);
    const ok = first ? await copyText(first.body) : false;
    setCopiedBtn(ok ? btn : null);
    if (ok) setTimeout(() => setCopiedBtn((b) => (b === btn ? null : b)), 2500);
  }

  async function load() {
    const rec = await getRouterDeskFn({ data: { id: routerId } });
    setData(rec);
    setForm({
      name: rec.router.name,
      identity: rec.router.identity,
      ros_version: rec.router.ros_version || "",
      model: rec.router.model || "",
      site_pop: rec.router.site_pop || rec.router.location || "",
      management_ip: rec.router.management_ip || "",
      role: rec.router.role,
    });
    if (hasPermission(rec.workspace.role, "routers.manage")) {
      try {
        const api = await getRouterApi({ data: { router_id: routerId } });
        setApiForm({
          api_user: api.api_user,
          api_password: api.api_password_hint || "",
          api_port: api.api_port,
          api_host: api.api_host || api.wg_address.replace(/\/\d+$/, ""),
          api_password_set: api.api_password_set,
          api_password_hint: api.api_password_hint,
        });
      } catch {
        /* API fields are optional until saved */
      }
    }
    setError(null);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load router"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerId]);

  useEffect(() => {
    if (search.tab === "monitoring") setShowMonitoring(true);
    if (search.action === "edit") setEditing(true);
  }, [search.tab, search.action]);

  const role = data?.workspace.role || "";
  const canManage = hasPermission(role, "routers.manage");
  const canMonitor = hasPermission(role, "traffic.view") || hasPermission(role, "routers.read");
  const dateFormat = data?.workspace.dateFormat || "dd/mm/yy";
  const router = data?.router;
  const pools = data?.pools || [];

  async function savePool(e: React.FormEvent) {
    e.preventDefault();
    if (!router) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        router_id: router.id,
        name: poolForm.name,
        code: poolForm.code,
        cidr: poolForm.cidr,
        gateway: poolForm.gateway,
        first_ip: poolForm.first_ip,
        last_ip: poolForm.last_ip,
        access_type: poolForm.access_type,
        vlan_id: poolForm.vlan_id,
        site_pop: poolForm.site_pop,
        description: poolForm.description,
        dns_servers: poolForm.dns_servers,
        status: poolForm.status,
      };
      if (editingPool) {
        await updateRouterPoolFn({
          data: { ...payload, pool_id: editingPool.id, confirm_impact: confirmImpact },
        });
      } else {
        await createRouterPoolFn({ data: payload });
      }
      setPoolOpen(false);
      setEditingPool(null);
      setConfirmImpact(false);
      setPoolForm(EMPTY_POOL);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save pool");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/app/routers" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" />
            Routers
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{router?.name || "Router"}</h1>
          <p className="text-sm text-muted">
            {router ? `${router.identity} · ${router.site_pop || "no site"}` : "Loading details…"}
          </p>
        </div>
        {router && canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "secondary" }), "inline-flex")}>
              <MoreHorizontal className="size-4" />
              Actions
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{router.name}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setEditing(true)}>Edit router</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  const out = await testRouterConnectionFn({ data: { id: router.id } });
                  setProbe(out);
                  setNote(
                    `${out.wireguard.status === "connected" ? "WireGuard connected" : "WireGuard not connected"} · ${
                      out.api.status === "connected" ? "API connected" : out.api.status === "failed" ? "API failed" : "API not verified"
                    } · ${
                      out.agent.status === "connected" ? "Agent connected" : "Agent not verified"
                    }`,
                  );
                }}
              >
                Test connection
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirmSync(true)}>Synchronize</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  document.getElementById("router-ip-pools")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Manage IP pools
              </DropdownMenuItem>
              {canMonitor ? (
                <DropdownMenuItem onSelect={() => setShowMonitoring(true)}>Show monitoring</DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await setRouterEnabledFn({ data: { id: router.id, enabled: false } });
                  await load();
                }}
              >
                Disable
              </DropdownMenuItem>
              <DropdownMenuItem danger onSelect={() => setConfirmArchive(true)}>
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {note ? <p className="text-sm text-ok">{note}</p> : null}

      {router ? (
        <>
          <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Info label="Provisioning">
              <Badge tone={statusTone(router.provisioning_status)}>{router.provisioning_status.replaceAll("_", " ")}</Badge>
            </Info>
            <Info label="Enrollment">
              <Badge tone={statusTone(router.enroll_state === "ENROLLED" ? "active" : router.enroll_state === "DEGRADED" ? "warning" : "pending")}>
                {router.connection_status || router.enroll_state || "Pending"}
              </Badge>
              <div className="mt-1 text-xs text-muted">
                WG {router.last_handshake_at ? "up" : "waiting"} · API {router.api_verified_at ? "verified" : "pending"} · Agent{" "}
                {router.agent_last_ok_at || router.last_seen ? "seen" : "silent"}
              </div>
            </Info>
            <Info label="Connection">
              <Badge tone={statusTone(router.reachability)}>{router.reachability}</Badge>
              <div className="mt-1 text-xs text-muted">
                {router.online ? "Agent heartbeat or pull received" : "No connectivity evidence yet"}
              </div>
            </Info>
            <Info label="Vendor / model">
              {[router.model, router.ros_version && `ROS ${router.ros_version}`].filter(Boolean).join(" · ") || "—"}
            </Info>
            <Info label="Management IP">
              <span className="font-mono text-xs">{router.management_ip || "—"}</span>
            </Info>
            <Info label="Overlay">
              <span className="font-mono text-xs">{router.wg_address || "—"}</span>
            </Info>
            <Info label="WireGuard public">
              <span className="break-all font-mono text-xs">{router.wg_public || "—"}</span>
            </Info>
            {router.wg_public && router.wg_address ? (
              <Info label="Hub peer (VPS)">
                <p className="text-xs text-muted">Handshake fails until this peer is on the VPS hub.</p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-elevated p-2 font-mono text-[11px]">
                  {hubPeerShell({ publicKey: router.wg_public, address: router.wg_address })}
                </pre>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={async () => {
                    const cmd = hubPeerShell({ publicKey: router.wg_public, address: router.wg_address });
                    if (await copyText(cmd)) {
                      setNote("Copied hub peer command");
                      setTimeout(() => setNote(null), 2500);
                    }
                  }}
                >
                  Copy hub peer command
                </Button>
              </Info>
            ) : null}
            <Info label="Hub">
              <span className="font-mono text-xs">
                {router.hub.ready ? `${router.hub.endpoint_host}:${router.hub.listen_port}` : "Not set"}
              </span>
            </Info>
            <Info label="Last seen">
              <span className="font-mono text-xs">{formatDateTime(router.last_seen, dateFormat)}</span>
            </Info>
            <Info label="Token">
              <span className="text-xs">
                {router.token.live
                  ? `Live · …${router.token.hint} · expires ${formatDateTime(router.token.expires_at, dateFormat)}`
                  : router.token.revoked
                    ? "Revoked"
                    : "None live"}
              </span>
            </Info>
            <Info label="Active services">{String(data?.service_count ?? 0)}</Info>
          </section>

          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const out = await issueRouterTokenFn({ data: { id: router.id } });
                    await openPack(
                      {
                        title: `Bootstrap · ${router.name}`,
                        identity: router.identity || router.name,
                        routerId: router.id,
                        kind: "bootstrap",
                        bootstrap: out.bootstrap,
                        enroll: out.enroll,
                      },
                      "bootstrap",
                    );
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not generate bootstrap");
                  }
                }}
              >
                {copiedBtn === "bootstrap" ? "Copied ✓" : "Generate bootstrap"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const out = await copyRouterScript({ data: { id: router.id } });
                  await openPack(
                    {
                      title: out.title || `Enrollment · ${router.name}`,
                      description: out.description,
                      identity: out.identity || router.identity,
                      routerId: out.routerId || router.id,
                      kind: "enroll",
                      enroll: out.script,
                    },
                    "enroll",
                  );
                }}
              >
                {copiedBtn === "enroll" ? "Copied ✓" : "Generate Enrollment Script"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const out = await repairRouterConnectionFn({ data: { id: router.id } });
                  await openPack(
                    {
                      title: out.title,
                      description: out.description,
                      identity: out.identity,
                      routerId: out.routerId,
                      kind: "repair",
                      enroll: out.script,
                    },
                    "repair",
                  );
                }}
              >
                {copiedBtn === "repair" ? "Copied ✓" : "Repair Connection"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const out = await rotateRouterWireGuardFn({ data: { id: router.id } });
                  await openPack(
                    {
                      title: out.title,
                      description: out.description,
                      identity: out.identity,
                      routerId: out.routerId,
                      kind: "wireguard-rotate",
                      enroll: out.script,
                    },
                    "wg",
                  );
                  await load();
                }}
              >
                {copiedBtn === "wg" ? "Copied ✓" : "Rotate WireGuard"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const out = await rotateRouterApiFn({ data: { id: router.id } });
                  await openPack(
                    {
                      title: out.title,
                      description: out.description,
                      identity: out.identity,
                      routerId: out.routerId,
                      kind: "api-rotate",
                      enroll: out.script,
                    },
                    "api-rotate",
                  );
                }}
              >
                {copiedBtn === "api-rotate" ? "Copied ✓" : "Rotate API Credentials"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const out = await regenerateRouterAgentFn({ data: { id: router.id } });
                  await openPack(
                    {
                      title: out.title,
                      description: out.description,
                      identity: out.identity,
                      routerId: out.routerId,
                      kind: "agent",
                      enroll: out.script,
                    },
                    "agent",
                  );
                }}
              >
                {copiedBtn === "agent" ? "Copied ✓" : "Regenerate Agent"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await revokeRouterTokenFn({ data: { id: router.id } });
                  setNote("Provisioning token revoked");
                  await load();
                }}
              >
                Revoke token
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmSync(true)}>
                Synchronize
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const out = await copyRouterApiUser({ data: { id: router.id } });
                  await openPack(
                    {
                      title: `API user · ${out.user}`,
                      identity: router.identity,
                      routerId: router.id,
                      extraLabel: "API user",
                      extra: out.script,
                    },
                    "api",
                  );
                }}
              >
                {copiedBtn === "api" ? "Copied ✓" : "Copy API user"}
              </Button>
            </div>
          ) : null}

          {canManage ? (
            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium">Connection</h2>
                  <p className="text-sm text-muted">WireGuard, RouterOS API, and agent are checked separately.</p>
                </div>
                <Button
                  size="sm"
                  onClick={async () => {
                    const out = await testRouterConnectionFn({ data: { id: router.id } });
                    setProbe(out);
                  }}
                >
                  Test Connection
                </Button>
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                <ProbeRow label="WireGuard" channel={probe?.wireguard} fallback={router.last_handshake_at ? "connected" : "not_verified"} />
                <ProbeRow label="RouterOS API" channel={probe?.api} fallback={router.api_verified_at ? "connected" : "not_verified"} />
                <ProbeRow label="Agent" channel={probe?.agent} fallback={router.agent_last_ok_at || router.last_seen ? "connected" : "not_verified"} />
              </ul>
            </section>
          ) : null}

          {canManage ? (
            <section className="grid gap-3 rounded-xl border border-border bg-surface p-4">
              <div>
                <h2 className="font-medium">API user</h2>
                <p className="text-sm text-muted">
                  REST is not used. The agent login is{" "}
                  <span className="font-mono">ispsolutions-agent</span> on TCP 8728, overlay only.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Username">
                  <Input
                    value={apiForm.api_user}
                    onChange={(e) => setApiForm({ ...apiForm, api_user: e.target.value })}
                  />
                </Field>
                <Field label="Password">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder={apiForm.api_password_set ? apiForm.api_password_hint || "Set" : "Not set"}
                    value={apiForm.api_password.startsWith("••••") ? "" : apiForm.api_password}
                    onChange={(e) => setApiForm({ ...apiForm, api_password: e.target.value })}
                  />
                </Field>
                <Field label="Host">
                  <Input
                    placeholder="10.200.0.2"
                    value={apiForm.api_host}
                    onChange={(e) => setApiForm({ ...apiForm, api_host: e.target.value })}
                  />
                </Field>
                <Field label="Port">
                  <Input
                    type="number"
                    value={apiForm.api_port}
                    onChange={(e) => setApiForm({ ...apiForm, api_port: Number(e.target.value) || 443 })}
                  />
                </Field>
              </div>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await saveRouterApi({
                        data: {
                          router_id: router.id,
                          api_user: apiForm.api_user,
                          api_password: apiForm.api_password,
                          api_port: apiForm.api_port,
                          api_host: apiForm.api_host,
                        },
                      });
                      setNote("API user saved");
                      await load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not save API user");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save API user
                </Button>
              </div>
            </section>
          ) : null}

          <section id="router-ip-pools" className="space-y-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">IP pools</h2>
                <p className="text-sm text-muted">Pools assigned to this router. Add a CIDR, then push from Synchronize if needed.</p>
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingPool(null);
                    setPoolForm({ ...EMPTY_POOL, site_pop: router.site_pop || "" });
                    setPoolOpen(true);
                  }}
                >
                  Add IP pool
                </Button>
              ) : null}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="bg-elevated text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Pool</th>
                    <th className="px-3 py-2 font-medium">CIDR / range</th>
                    <th className="px-3 py-2 font-medium">Access</th>
                    <th className="px-3 py-2 font-medium">VLAN</th>
                    <th className="px-3 py-2 font-medium">Site</th>
                    <th className="px-3 py-2 font-medium">Usage</th>
                    <th className="px-3 py-2 font-medium">Services</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pools.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-sm text-muted">
                        No IP pools on this router yet.
                      </td>
                    </tr>
                  ) : (
                    pools.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{p.name}</div>
                          {p.code ? <div className="font-mono text-xs text-muted">{p.code}</div> : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {p.cidr}
                          <div className="text-muted">
                            {p.first_ip && p.last_ip ? `${p.first_ip}–${p.last_ip}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">{p.access_type || "—"}</td>
                        <td className="px-3 py-2 text-xs">{p.vlan_id ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">{p.site_pop || "—"}</td>
                        <td className="px-3 py-2 text-xs">
                          {p.used}/{p.total} used · {p.available} free
                        </td>
                        <td className="px-3 py-2 text-xs">{p.assigned_services}</td>
                        <td className="px-3 py-2">
                          <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{formatDateTime(p.updated_at, dateFormat)}</td>
                        <td className="px-3 py-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-9")}>
                              <MoreHorizontal className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={async () => {
                                  setUsagePool(p);
                                  const out = await listRouterPoolAssignmentsFn({ data: { pool_id: p.id } });
                                  setAssignments(out.assignments);
                                }}
                              >
                                View assigned services
                              </DropdownMenuItem>
                              {canManage ? (
                                <>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setEditingPool(p);
                                      setPoolForm({
                                        name: p.name,
                                        code: p.code,
                                        cidr: p.cidr,
                                        gateway: p.gateway,
                                        first_ip: p.first_ip,
                                        last_ip: p.last_ip,
                                        access_type: p.access_type || "pppoe",
                                        vlan_id: p.vlan_id == null ? "" : String(p.vlan_id),
                                        site_pop: p.site_pop,
                                        description: p.description,
                                        dns_servers: p.dns_servers,
                                        status: p.status,
                                      });
                                      setConfirmImpact(false);
                                      setPoolOpen(true);
                                    }}
                                  >
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={async () => {
                                      await setPoolEnabledFn({
                                        data: { router_id: router.id, pool_id: p.id, enabled: p.status !== "active" },
                                      });
                                      await load();
                                    }}
                                  >
                                    {p.status === "active" ? "Disable" : "Enable"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem danger onSelect={() => setRemovePool(p)}>
                                    Archive
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {canMonitor ? (
            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-medium">Monitoring</h2>
                  <p className="text-sm text-muted">Stored collector samples only. Nothing is invented.</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowMonitoring((v) => !v)}
                >
                  {showMonitoring ? "Hide monitoring" : "Show monitoring"}
                </Button>
              </div>
              {showMonitoring ? <div className="mt-4"><RouterMonitor routerId={router.id} active /></div> : null}
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 font-medium">Configuration versions</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {(data?.history || []).length === 0 ? <li className="px-3 py-3 text-sm text-muted">None yet</li> : null}
                {(data?.history || []).map((v) => (
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
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 font-medium">Provisioning log</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {(data?.events || []).length === 0 ? <li className="px-3 py-3 text-sm text-muted">No events</li> : null}
                {(data?.events || []).map((ev) => (
                  <li key={ev.id} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{ev.event.replaceAll("_", " ")}</span>
                      <span className="text-xs text-muted">{formatDateTime(ev.created_at, dateFormat)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      ) : null}

      <Dialog open={editing} onOpenChange={setEditing} title="Edit router" className="sm:max-w-xl">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await updateRouter({ data: { id: routerId, ...form, location: form.site_pop } });
              setEditing(false);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Router name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Identity">
            <Input value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} />
          </Field>
          <Field label="RouterOS version">
            <Input value={form.ros_version} onChange={(e) => setForm({ ...form, ros_version: e.target.value })} />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field label="Site / POP">
            <Input value={form.site_pop} onChange={(e) => setForm({ ...form, site_pop: e.target.value })} />
          </Field>
          <Field label="Management IP">
            <Input value={form.management_ip} onChange={(e) => setForm({ ...form, management_ip: e.target.value })} />
          </Field>
          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={poolOpen}
        onOpenChange={setPoolOpen}
        title={editingPool ? "Edit IP pool" : "Add IP pool"}
        description="Assigned to this router. Overlapping tenant ranges are rejected."
        className="sm:max-w-xl"
      >
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={savePool}>
          <Field label="Pool name">
            <Input required value={poolForm.name} onChange={(e) => setPoolForm({ ...poolForm, name: e.target.value })} />
          </Field>
          <Field label="Code">
            <Input value={poolForm.code} onChange={(e) => setPoolForm({ ...poolForm, code: e.target.value })} />
          </Field>
          <Field label="CIDR">
            <Input required value={poolForm.cidr} onChange={(e) => setPoolForm({ ...poolForm, cidr: e.target.value })} placeholder="10.10.10.0/24" />
          </Field>
          <Field label="Gateway">
            <Input value={poolForm.gateway} onChange={(e) => setPoolForm({ ...poolForm, gateway: e.target.value })} />
          </Field>
          <Field label="First IP">
            <Input value={poolForm.first_ip} onChange={(e) => setPoolForm({ ...poolForm, first_ip: e.target.value })} />
          </Field>
          <Field label="Last IP">
            <Input value={poolForm.last_ip} onChange={(e) => setPoolForm({ ...poolForm, last_ip: e.target.value })} />
          </Field>
          <Field label="Access type">
            <Select value={poolForm.access_type} onChange={(e) => setPoolForm({ ...poolForm, access_type: e.target.value })}>
              <option value="pppoe">PPPoE</option>
              <option value="static">Static IP</option>
              <option value="hotspot">Hotspot</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="VLAN ID">
            <Input value={poolForm.vlan_id} onChange={(e) => setPoolForm({ ...poolForm, vlan_id: e.target.value })} />
          </Field>
          <Field label="Site / POP">
            <Input value={poolForm.site_pop} onChange={(e) => setPoolForm({ ...poolForm, site_pop: e.target.value })} />
          </Field>
          <Field label="DNS servers">
            <Input value={poolForm.dns_servers} onChange={(e) => setPoolForm({ ...poolForm, dns_servers: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea value={poolForm.description} onChange={(e) => setPoolForm({ ...poolForm, description: e.target.value })} />
            </Field>
          </div>
          {editingPool && editingPool.used > 0 ? (
            <label className="sm:col-span-2 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={confirmImpact} onChange={(e) => setConfirmImpact(e.target.checked)} />
              This pool has {editingPool.used} assigned addresses. I confirm CIDR, gateway, range, VLAN, or access changes.
            </label>
          ) : null}
          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit" disabled={busy}>
              {editingPool ? "Save pool" : "Create pool"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPoolOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(usagePool)}
        onOpenChange={(open) => {
          if (!open) setUsagePool(null);
        }}
        title={usagePool ? `${usagePool.name} usage` : "IP usage"}
      >
        <p className="text-sm text-muted">
          {usagePool ? `${usagePool.used} used · ${usagePool.available} available · ${usagePool.assigned_services} services` : ""}
        </p>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {assignments.length === 0 ? <li className="px-3 py-3 text-sm text-muted">No assigned services.</li> : null}
          {assignments.map((a) => (
            <li key={`${a.address}-${a.customer_name}`} className="px-3 py-2 text-sm">
              {a.customer_name} · {a.username || "—"} · <span className="font-mono text-xs">{a.address}</span>
            </li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={Boolean(removePool)}
        onOpenChange={(open) => {
          if (!open) setRemovePool(null);
        }}
        title="Archive IP pool"
        description={
          removePool
            ? `Hide ${removePool.name}. Blocked if services still use addresses from this pool.`
            : undefined
        }
      >
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (!removePool || !router) return;
              setBusy(true);
              try {
                await archiveRouterPoolFn({ data: { router_id: router.id, pool_id: removePool.id } });
                setRemovePool(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not archive pool");
              } finally {
                setBusy(false);
              }
            }}
          >
            Archive
          </Button>
          <Button type="button" variant="secondary" onClick={() => setRemovePool(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      <Dialog open={confirmSync} onOpenChange={setConfirmSync} title="Synchronize configuration">
        <p className="text-sm text-muted">Issues a new bootstrap token and queues assigned pools. The previous token stops working.</p>
        <div className="mt-3 flex gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const out = await reconfigureRouterFn({ data: { id: routerId } });
                await openPack(
                  {
                    title: "Re-provision",
                    bootstrap: out.bootstrap,
                    enroll: out.enroll,
                  },
                  "sync",
                );
                setConfirmSync(false);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Synchronize failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Synchronize
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmSync(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      <Dialog open={confirmArchive} onOpenChange={setConfirmArchive} title="Archive router">
        <p className="text-sm text-muted">Hides this router from the live fleet. History is kept.</p>
        <div className="mt-3 flex gap-2">
          <Button
            variant="danger"
            onClick={async () => {
              await archiveRouterFn({ data: { id: routerId } });
              void navigate({ to: "/app/routers" });
            }}
          >
            Archive
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmArchive(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      <RosScriptDialog pack={pack} onClose={() => setPack(null)} />
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function ProbeRow({
  label,
  channel,
  fallback,
}: {
  label: string;
  channel?: { ok: boolean; status: string; detail: string } | null;
  fallback: string;
}) {
  const status = channel?.status || fallback;
  const mark = status === "connected" ? "✓" : status === "failed" ? "✕" : "—";
  const text =
    channel?.detail ||
    (status === "connected" ? "Connected" : status === "failed" ? "Failed" : "Not verified");
  return (
    <li className="rounded-lg border border-border bg-elevated px-3 py-2 text-sm">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-medium">
        {mark} {text}
      </div>
    </li>
  );
}
