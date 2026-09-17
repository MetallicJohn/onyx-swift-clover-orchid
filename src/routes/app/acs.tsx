import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AcsCredentialsPanel } from "@/components/isp/acs-credentials-panel";
import { AcsDeviceDesk } from "@/components/isp/acs-device-desk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getAcsCredentialsFn, listAcs, saveAcsSettings, syncAcsFromNbi } from "@/lib/isp/server-ops";

type TabId = "devices" | "credentials" | "nbi";

export const Route = createFileRoute("/app/acs")({
  validateSearch: (search: Record<string, unknown>): { tab?: TabId } => ({
    tab: search.tab === "credentials" || search.tab === "nbi" ? search.tab : undefined,
  }),
  component: AcsPage,
});

type Creds = NonNullable<Awaited<ReturnType<typeof getAcsCredentialsFn>>["credentials"]>;
type Can = Awaited<ReturnType<typeof getAcsCredentialsFn>>["can"];
type Security = Awaited<ReturnType<typeof getAcsCredentialsFn>>["security"];

function AcsPage() {
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const tab: TabId = tabParam === "credentials" || tabParam === "nbi" ? tabParam : "devices";

  const [connection, setConnection] = useState<Awaited<ReturnType<typeof listAcs>>["connection"] | null>(null);
  const [nbi, setNbi] = useState({ nbiUrl: "", user: "", pass: "", oui: "" });
  const [note, setNote] = useState<string | null>(null);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [can, setCan] = useState<Can>({ manage: false, reveal: false, rotate: false, test: false });
  const [security, setSecurity] = useState<Security | null>(null);
  const [nbiConfigured, setNbiConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadMeta() {
    const [r, c] = await Promise.all([listAcs().catch(() => null), getAcsCredentialsFn().catch(() => null)]);
    if (r) {
      setConnection(r.connection);
      setNbi({
        nbiUrl: r.connection.nbiUrl || "http://genieacs:7557",
        user: r.connection.user,
        pass: r.connection.passHint ? "••••" : "",
        oui: r.connection.oui,
      });
    }
    if (c) {
      setCreds(c.credentials);
      setCan(c.can);
      setSecurity(c.security);
      setNbiConfigured(c.nbi_configured);
    }
  }

  useEffect(() => {
    loadMeta().catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {tab === "credentials" ? "ACS credentials" : tab === "nbi" ? "GenieACS NBI" : "GenieACS Devices"}
        </h1>
        <p className="text-sm text-muted">
          {tab === "devices"
            ? "Manage connected CPE/ONU devices, assign them to customers and services, and perform supported device actions."
            : "ACS credentials stay on the OLT. NBI is how this console talks to GenieACS."}
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

      {tab === "devices" ? <AcsDeviceDesk /> : null}

      {tab === "credentials" ? (
        <AcsCredentialsPanel
          creds={creds}
          can={can}
          security={security}
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
    </div>
  );
}
