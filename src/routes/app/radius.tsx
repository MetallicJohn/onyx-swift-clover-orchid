import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { disconnectRadius, exportRadiusUsers, listRadius } from "@/lib/isp/server-ops";

export const Route = createFileRoute("/app/radius")({ component: RadiusPage });

function RadiusPage() {
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof listRadius>>["accounts"]>([]);
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listRadius>>["sessions"]>([]);
  const [exportText, setExportText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const r = await listRadius();
    setAccounts(r.accounts);
    setSessions(r.sessions);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">RADIUS</h1>
          <p className="text-sm text-muted">
            Desired state for FreeRADIUS. This console is not a RADIUS server. Suspend rejects auth; Disconnect queues
            CoA/kick on the agent.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={async () => {
            const r = await exportRadiusUsers();
            setExportText(r.users);
            await navigator.clipboard.writeText(r.users).catch(() => undefined);
            setNote("FreeRADIUS users file copied");
          }}
        >
          Copy FreeRADIUS users
        </Button>
      </div>

      {note ? <p className="text-sm text-accent">{note}</p> : null}

      <section className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Group</th>
              <th className="px-4 py-3 font-medium">Rate</th>
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

      {exportText ? (
        <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-surface p-4 text-xs">{exportText}</pre>
      ) : null}
    </div>
  );
}
