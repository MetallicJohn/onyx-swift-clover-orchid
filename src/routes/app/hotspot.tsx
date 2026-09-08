import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { activateHotspotVoucher, createVouchers, listHotspot, revokeHotspotVoucher } from "@/lib/isp/server-ops";

export const Route = createFileRoute("/app/hotspot")({ component: HotspotPage });

function toneFor(status: string) {
  if (status === "unused") return statusTone("pending");
  if (status === "active") return statusTone("active");
  if (status === "expired") return statusTone("grace");
  return statusTone("suspended");
}

function HotspotPage() {
  const [vouchers, setVouchers] = useState<Awaited<ReturnType<typeof listHotspot>>["vouchers"]>([]);
  const [packages, setPackages] = useState<{ id: string; name: string }[]>([]);
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof listHotspot>>["sessions"]>([]);
  const [form, setForm] = useState({ package_id: "", count: 5, hours: 24 });
  const [codes, setCodes] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const r = await listHotspot();
    setVouchers(r.vouchers);
    setPackages(r.packages);
    setSessions(r.sessions);
    if (!form.package_id && r.packages[0]) setForm((f) => ({ ...f, package_id: r.packages[0].id }));
  }
  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hotspot</h1>
        <p className="text-sm text-muted">
          Unused codes wait at the till. Activate creates RADIUS + a hotspot service; expiry disables both.
        </p>
      </div>

      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await createVouchers({ data: form });
          setCodes(r.codes);
          await load();
        }}
      >
        <Field label="Package">
          <Select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Count">
          <Input type="number" min={1} max={50} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} />
        </Field>
        <Field label="Hours after activate">
          <Input type="number" min={1} value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} />
        </Field>
        <div className="flex items-end">
          <Button type="submit">Generate</Button>
        </div>
      </form>

      {codes.length ? (
        <p className="rounded-xl border border-border bg-elevated p-3 font-mono text-xs">{codes.join("  ")}</p>
      ) : null}
      {note ? <p className="text-sm text-accent">{note}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vouchers.map((v) => (
          <article key={v.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between">
              <div className="font-mono text-sm">{v.code}</div>
              <Badge tone={toneFor(v.status)}>{v.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted">
              {v.package_name} · {v.hours}h
              {v.expires_at ? ` · until ${v.expires_at.slice(0, 16).replace("T", " ")}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {v.status === "unused" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const r = await activateHotspotVoucher({ data: { id: v.id } });
                    setNote(`Activated ${r.code} until ${r.expires_at.slice(0, 16).replace("T", " ")}`);
                    await load();
                  }}
                >
                  Activate
                </Button>
              ) : null}
              {v.status === "unused" || v.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await revokeHotspotVoucher({ data: { id: v.id } });
                    await load();
                  }}
                >
                  Revoke
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <section>
        <h2 className="mb-3 font-medium">Hotspot sessions</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium">NAS</th>
                <th className="px-4 py-3 font-medium">Stopped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-muted" colSpan={4}>
                    Sessions appear when RADIUS accounting is received.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-mono text-xs">{s.username}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.framed_ip}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.nas_ip}</td>
                    <td className="px-4 py-3 text-xs">{s.stopped_at ? "yes" : "online"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
