import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/brand";
import { disconnectRadius, exportRadiusUsers, listRadius, rotateRadiusKey } from "@/lib/isp/server-ops";

export const Route = createFileRoute("/app/radius")({ component: RadiusPage });

type RadiusList = Awaited<ReturnType<typeof listRadius>>;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function RadiusPage() {
  const [accounts, setAccounts] = useState<RadiusList["accounts"]>([]);
  const [sessions, setSessions] = useState<RadiusList["sessions"]>([]);
  const [events, setEvents] = useState<RadiusList["events"]>([]);
  const [config, setConfig] = useState<RadiusList["config"] | null>(null);
  const [slug, setSlug] = useState("");
  const [keyHint, setKeyHint] = useState("");
  const [revealedKey, setRevealedKey] = useState("");
  const [exportText, setExportText] = useState("");
  const [nasSecret, setNasSecret] = useState("");
  const [vpsEnv, setVpsEnv] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<"rest" | "site" | "clients" | "mikrotik" | "users" | "">("");

  async function load() {
    const r = await listRadius();
    setAccounts(r.accounts);
    setSessions(r.sessions);
    setEvents(r.events);
    setConfig(r.config);
    setSlug(r.slug);
    setKeyHint(r.api_key_hint);
    if (r.api_key) setRevealedKey(r.api_key);
    setNasSecret(r.nas_secret);
    setVpsEnv(r.vps_env);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function show(kind: "rest" | "site" | "clients" | "mikrotik" | "users") {
    if (kind === "users") {
      const r = await exportRadiusUsers();
      setExportText(r.users);
      setSnippet("users");
      await copyText(r.users);
      setNote("FreeRADIUS users file copied");
      return;
    }
    if (!config) return;
    const text = config[kind];
    setExportText(text);
    setSnippet(kind);
    await copyText(text);
    setNote(`${kind} config copied`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">RADIUS</h1>
          <p className="text-sm text-muted">
            {APP_NAME} is the source of truth. FreeRADIUS beside this app (UDP 1812/1813) authorizes over REST.
            Suspend rejects the next Access-Request; Disconnect kicks the session on the router.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void show("rest")}>
            Copy REST module
          </Button>
          <Button variant="secondary" onClick={() => void show("users")}>
            Copy users file
          </Button>
        </div>
      </div>

      {note ? <p className="text-sm text-accent">{note}</p> : null}

      <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
        <div>
          <h2 className="font-medium">FreeRADIUS REST</h2>
          <p className="mt-1 text-sm text-muted">
            On the VPS the FreeRADIUS container pulls this config. Tenant slug{" "}
            <span className="font-mono text-fg">{slug || "—"}</span>. NAS secret{" "}
            <span className="font-mono text-fg">{nasSecret || "—"}</span>.
          </p>
          <p className="mt-3 font-mono text-xs text-muted">
            Key {revealedKey || keyHint || "not issued"}
            {revealedKey ? " · copy now, it is not stored in the clear" : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const r = await rotateRadiusKey();
                setRevealedKey(r.key);
                setKeyHint(r.hint);
                await copyText(r.key);
                setNote("New RADIUS API key copied");
              }}
            >
              Rotate key
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void show("site")}>
              Site
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void show("clients")}>
              clients.conf
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void show("mikrotik")}>
              MikroTik snippet
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                if (!vpsEnv) return;
                setExportText(vpsEnv);
                await copyText(vpsEnv);
                setNote("VPS RADIUS env copied — paste into gridline.env and restart freeradius");
              }}
            >
              Copy VPS env
            </Button>
          </div>
        </div>
        <div className="text-sm text-muted">
          <ol className="list-decimal space-y-1 pl-4">
            <li>VPS compose already starts FreeRADIUS. Copy VPS env (slug + API key + NAS secret) into gridline.env and restart the freeradius container.</li>
            <li>Point each MikroTik at this VPS UDP 1812/1813 with the NAS secret. Paste the MikroTik snippet.</li>
            <li>Accounting POSTs update usage. A data cap or suspend rejects the next Access-Request.</li>
          </ol>
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Profile</th>
              <th className="px-4 py-3 font-medium">Package rate</th>
              <th className="px-4 py-3 font-medium">Framed IP</th>
              <th className="px-4 py-3 font-medium">Secret</th>
              <th className="px-4 py-3 font-medium">Auth</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-mono text-xs">{a.username}</td>
                <td className="px-4 py-3">
                  {a.customer_name}
                  <div className="text-xs text-muted uppercase">{a.access_method}</div>
                </td>
                <td className="px-4 py-3">{a.group_name}</td>
                <td className="px-4 py-3 font-mono text-xs">{a.rate_limit || "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">{a.framed_ip || "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">{a.password}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(a.enabled ? "active" : "suspended")}>{a.enabled ? "accept" : "reject"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-3 font-medium">Active / recent sessions</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium">NAS</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-mono text-xs">{s.username}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.framed_ip}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.nas_ip}</td>
                  <td className="px-4 py-3 text-xs">
                    ↓ {(s.bytes_in / 1_000_000).toFixed(0)} MB · ↑ {(s.bytes_out / 1_000_000).toFixed(0)} MB
                    {s.stopped_at ? <span className="text-muted"> · stopped</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    {s.stopped_at ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          const r = await disconnectRadius({ data: { username: s.username } });
                          setNote(`Disconnect queued (${r.kind})`);
                          await load();
                        }}
                      >
                        Disconnect
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {events.length ? (
        <section>
          <h2 className="mb-3 font-medium">Recent Access-Requests</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="bg-surface text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">NAS</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 font-mono text-xs">{e.username}</td>
                    <td className="px-4 py-3 font-mono text-xs">{e.nas_ip || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(e.result === "accept" ? "active" : "suspended")}>
                        {e.result}
                        {e.reason && e.reason !== "ok" ? ` · ${e.reason}` : ""}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{e.created_at.replace("T", " ").slice(0, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {exportText ? (
        <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-surface p-4 text-xs">
          {snippet ? `# ${snippet}\n` : ""}
          {exportText}
        </pre>
      ) : null}
    </div>
  );
}
