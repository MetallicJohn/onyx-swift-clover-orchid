import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AcsCredentialsPanel } from "@/components/isp/acs-credentials-panel";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listCpeTasks, queueCpeTask } from "@/lib/isp/server-more";
import { addCpe, getAcsCredentialsFn, informCpe, listAcs, saveAcsSettings, syncAcsFromNbi } from "@/lib/isp/server-ops";

type TabId = "devices" | "credentials" | "nbi";

export const Route = createFileRoute("/app/acs")({
  validateSearch: (search: Record<string, unknown>): { tab?: TabId } => ({
    tab: search.tab === "credentials" || search.tab === "nbi" ? search.tab : undefined,
  }),
  component: AcsPage,
});

type Creds = NonNullable<Awaited<ReturnType<typeof getAcsCredentialsFn>>["credentials"]>;
type Can = Awaited<ReturnType<typeof getAcsCredentialsFn>>["can"];

function AcsPage() {
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const tab: TabId = tabParam === "credentials" || tabParam === "nbi" ? tabParam : "devices";

  const [devices, setDevices] = useState<Awaited<ReturnType<typeof listAcs>>["devices"]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof listCpeTasks>>["tasks"]>([]);
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof listAcs>>["connection"] | null>(null);
  const [form, setForm] = useState({ serial: "", product_class: "F670L", ssid: "", customer_id: "" });
  const [nbi, setNbi] = useState({ nbiUrl: "", user: "", pass: "", oui: "" });
  const [note, setNote] = useState<string | null>(null);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [can, setCan] = useState<Can>({ manage: false, reveal: false, rotate: false, test: false });
  const [nbiConfigured, setNbiConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [r, t, c] = await Promise.all([listAcs(), listCpeTasks(), getAcsCredentialsFn()]);
    setDevices(r.devices);
    setCustomers(r.customers);
    setConnection(r.connection);
    setNbi({
      nbiUrl: r.connection.nbiUrl || "http://genieacs:7557",
      user: r.connection.user,
      pass: r.connection.passHint ? "••••" : "",
      oui: r.connection.oui,
    });
    setTasks(t.tasks);
    setCreds(c.credentials);
    setCan(c.can);
    setNbiConfigured(c.nbi_configured);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GenieACS</h1>
        <p className="text-sm text-muted">
          Generate a unique ACS URL and credentials for this ISP, paste them on the OLT so ONUs inform automatically,
          then manage CPEs here. NBI is how this console talks to GenieACS — it is never exposed to ONUs.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="ACS sections"
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
      >
        {(
          [
            ["devices", "Devices"],
            ["credentials", "ACS credentials"],
            ["nbi", "NBI"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              "h-11 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors",
              tab === id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={() => {
              void navigate({ search: { tab: id === "devices" ? undefined : id }, replace: true });
              setNote(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {note ? <p className="text-sm text-accent">{note}</p> : null}

      {tab === "credentials" ? (
        <AcsCredentialsPanel
          creds={creds}
          can={can}
          nbiConfigured={nbiConfigured}
          busy={busy}
          setBusy={setBusy}
          setCreds={setCreds}
          setNote={setNote}
        />
      ) : null}

      {tab === "nbi" ? (
        <form
          className="grid max-w-3xl gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2 md:p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const next = await saveAcsSettings({ data: nbi });
            setConnection(next);
            setNote(next.reachable ? "NBI reachable." : next.error || "Saved. NBI not reachable yet.");
          }}
        >
          <h2 className="font-medium md:col-span-2">NBI connection</h2>
          <p className="text-sm text-muted md:col-span-2">
            Northbound API this console uses to list CPEs and queue reboot/SSID tasks. ONUs do not use these fields.
          </p>
          <Field label="NBI URL">
            <Input
              placeholder="http://genieacs:7557"
              value={nbi.nbiUrl}
              onChange={(e) => setNbi({ ...nbi, nbiUrl: e.target.value })}
            />
          </Field>
          <Field label="Manufacturer OUI">
            <Input placeholder="1A2B3C" value={nbi.oui} onChange={(e) => setNbi({ ...nbi, oui: e.target.value })} />
          </Field>
          <Field label="NBI user">
            <Input value={nbi.user} onChange={(e) => setNbi({ ...nbi, user: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="NBI password">
            <Input
              type="password"
              value={nbi.pass}
              onChange={(e) => setNbi({ ...nbi, pass: e.target.value })}
              autoComplete="new-password"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <Button type="submit">Save NBI</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const r = await syncAcsFromNbi();
                setNote(`Synced ${r.upserted} CPE(s) from GenieACS.`);
                await load();
              }}
            >
              Sync from ACS
            </Button>
            <Badge tone={connection?.reachable ? "ok" : connection?.configured ? "warn" : "muted"}>
              {connection?.reachable ? "NBI up" : connection?.configured ? "NBI down" : "Not configured"}
            </Badge>
          </div>
        </form>
      ) : null}

      {tab === "devices" ? (
        <>
          <form
            className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await addCpe({ data: form });
              setForm({ ...form, serial: "", ssid: "" });
              await load();
            }}
          >
            <h2 className="font-medium md:col-span-2">Register CPE</h2>
            <Field label="Serial">
              <Input required value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
            </Field>
            <Field label="Product class">
              <Input value={form.product_class} onChange={(e) => setForm({ ...form, product_class: e.target.value })} />
            </Field>
            <Field label="SSID">
              <Input value={form.ssid} onChange={(e) => setForm({ ...form, ssid: e.target.value })} />
            </Field>
            <Field label="Customer">
              <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">Unassigned</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button type="submit">Register CPE</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  const r = await syncAcsFromNbi();
                  setNote(`Synced ${r.upserted} CPE(s) from GenieACS.`);
                  await load();
                }}
              >
                Sync from ACS
              </Button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-surface text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Serial</th>
                  <th className="px-4 py-3 font-medium">Class</th>
                  <th className="px-4 py-3 font-medium">SSID</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">ACS id</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 font-mono text-xs">{d.serial}</td>
                    <td className="px-4 py-3">{d.product_class}</td>
                    <td className="px-4 py-3">{d.ssid}</td>
                    <td className="px-4 py-3">{d.customer_name ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{d.acs_device_id || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await informCpe({ data: { id: d.id } });
                            await load();
                          }}
                        >
                          Refresh
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await queueCpeTask({ data: { cpe_id: d.id, kind: "reboot" } });
                            await load();
                          }}
                        >
                          Reboot
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const ssid = window.prompt("SSID", d.ssid) || "";
                            if (!ssid) return;
                            await queueCpeTask({ data: { cpe_id: d.id, kind: "setSsid", ssid } });
                            await load();
                          }}
                        >
                          Set SSID
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {devices.length === 0 ? (
            <p className="text-sm text-muted">
              No CPEs yet. Generate ACS credentials, push them from the OLT, then sync — or register a serial here.
            </p>
          ) : null}

          <section>
            <h2 className="mb-3 font-medium">ACS task queue</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {tasks.length === 0 ? (
                <li className="px-4 py-6 text-sm text-muted">No tasks. Reboot or set SSID on a CPE that has informed.</li>
              ) : null}
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 bg-surface px-4 py-3 text-sm">
                  <span className="font-mono text-xs">
                    {t.serial} · {t.kind}
                    {t.result ? ` · ${t.result}` : ""}
                  </span>
                  <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
