import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { addRouter, listRouters } from "@/lib/isp/server";
import { approveRouterCommand, getRouterApi, previewRouterCommand, queueRouterCommand, runRouterApi, saveRouterApi } from "@/lib/isp/server-mikrotik";
import { copyRouterScript, updateRouter } from "@/lib/isp/server-routers";
import { listAgentQueue, simulateAgentPull } from "@/lib/isp/server-ops";
import type { RouterRow } from "@/lib/isp/types";

export const Route = createFileRoute("/app/routers")({ component: RoutersPage });

const EMPTY = { name: "", location: "", identity: "", role: "access" };

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
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [scriptLabel, setScriptLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const [commands, setCommands] = useState<{ id: string; router_name: string; kind: string; status: string; created_at: string }[]>([]);
  const [apiRouter, setApiRouter] = useState<string>("");
  const [api, setApi] = useState({
    api_user: "gridline",
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

  async function load() {
    const [res, q] = await Promise.all([listRouters(), listAgentQueue()]);
    setRows(res.routers);
    setCommands(q.commands);
    if (!apiRouter && res.routers[0]) setApiRouter(res.routers[0].id);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (!apiRouter) return;
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
  }, [apiRouter]);

  async function showScript(text: string, label: string, copy = true) {
    setScript(text);
    setScriptLabel(label);
    if (copy) {
      const ok = await copyText(text);
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 2500);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId) {
      const saved = await updateRouter({ data: { id: editingId, ...form } });
      setEditingId(null);
      setForm(EMPTY);
      await showScript(saved.script, `Updated · paste on ${form.name}`, false);
      await load();
      return;
    }
    const created = await addRouter({ data: form });
    await showScript(created.script, `New router · paste on ${form.name}`);
    setForm(EMPTY);
    await load();
  }

  function startEdit(r: RouterRow) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      location: r.location,
      identity: r.identity,
      role: r.role,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Routers</h1>
        <p className="text-sm text-muted">
          Agent + WireGuard model. Routers never expose API ports to the public internet. Copy the RouterOS script
          whenever you enroll a fresh or factory-reset device.
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium">{editingId ? "Edit router" : "Add router"}</h2>
        <Field label="Name">
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label="Identity">
          <Input value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="core">Core</option>
            <option value="edge">Edge</option>
            <option value="access">Access</option>
            <option value="hotspot">Hotspot</option>
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{editingId ? "Save router" : "Add router"}</Button>
          {editingId ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      {script ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">{scriptLabel || "RouterOS v7 script — paste in New Terminal or /import"}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await showScript(script, scriptLabel);
              }}
            >
              {copied ? "Copied" : "Copy script"}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg">
            {script}
          </pre>
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Router</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">WireGuard</th>
              <th className="px-4 py-3 font-medium">CPU</th>
              <th className="px-4 py-3 font-medium">Uptime</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <div>{r.name}</div>
                  <div className="text-xs text-muted">
                    {r.identity}
                    {r.location ? ` · ${r.location}` : ""}
                  </div>
                </td>
                <td className="px-4 py-3 capitalize">{r.role}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(r.wg_status)}>{r.wg_status}</Badge>
                </td>
                <td className="px-4 py-3 font-mono">{r.cpu_pct}%</td>
                <td className="px-4 py-3 font-mono">{r.uptime_hours}h</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => startEdit(r)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setApiRouter(r.id)}>
                      API
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const out = await copyRouterScript({ data: { id: r.id } });
                        await showScript(out.script, `Enroll ${r.name}`);
                      }}
                    >
                      Copy script
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const out = await copyRouterScript({ data: { id: r.id, rotate: true } });
                        await showScript(out.script, `Fresh enroll token · ${r.name}`);
                        await load();
                      }}
                    >
                      New token
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const pull = await simulateAgentPull({ data: { router_id: r.id } });
                        await showScript(pull.script, `Agent pull · ${r.name}`, false);
                        await load();
                      }}
                    >
                      Agent pull
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              if (!apiRouter) return;
              const info = await getRouterApi({ data: { router_id: apiRouter } });
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
            Load
          </Button>
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
            <option value="raw.script">Raw RouterOS script</option>
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
        {cmd.kind === "raw.script" ? (
          <Field label="Script">
            <Input value={cmd.script} onChange={(e) => setCmd({ ...cmd, script: e.target.value })} />
          </Field>
        ) : null}
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
          {commands.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No commands yet. Provision or suspend a service.</li> : null}
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
    </div>
  );
}
