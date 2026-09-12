import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  generateAcsCredentialsFn,
  revealAcsCredentialsFn,
  saveAcsCredentialsFn,
  testAcsConnectionFn,
} from "@/lib/isp/server-ops";

type Desk = Awaited<ReturnType<typeof generateAcsCredentialsFn>>;
type Can = {
  manage: boolean;
  reveal: boolean;
  rotate: boolean;
  test: boolean;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyRow({ label, value, secret, onCopy }: { label: string; value: string; secret?: boolean; onCopy: (ok: boolean, msg: string) => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
        <p className="mt-1 break-all font-mono text-sm">{secret ? value || "••••" : value || "—"}</p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        type="button"
        disabled={!value}
        onClick={async () => {
          const ok = await copyText(value);
          onCopy(ok, ok ? `${label} copied` : "Copy failed — the browser blocked the clipboard");
        }}
      >
        Copy
      </Button>
    </div>
  );
}

export function AcsCredentialsPanel({
  creds,
  can,
  nbiConfigured,
  busy,
  setBusy,
  setCreds,
  setNote,
}: {
  creds: Desk | null;
  can: Can;
  nbiConfigured: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setCreds: (v: Desk | null) => void;
  setNote: (v: string | null) => void;
}) {
  const [inform, setInform] = useState(creds?.inform_interval || 300);
  const [enabled, setEnabled] = useState(creds?.enabled !== false);
  const [snippet, setSnippet] = useState<"huawei" | "zte" | "fiberhome" | "params" | "">("");
  const revealed = Boolean(creds?.password);
  const snipText = snippet && creds?.snippets ? creds.snippets[snippet] : "";

  function flash(ok: boolean, msg: string) {
    setNote(msg);
    if (!ok) return;
  }

  async function generate(rotate: boolean) {
    if (rotate && !window.confirm("Rotate ACS and connection-request passwords? Update the OLT TR-069 profile or ONUs will stop informing. Existing serials are not renamed.")) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const row = await generateAcsCredentialsFn({ data: { rotate } });
      setCreds(row);
      setInform(row.inform_interval);
      setEnabled(row.enabled);
      setNote(
        rotate
          ? "Passwords rotated. Copy them onto the OLT before ONUs retry inform."
          : "ACS credentials generated. Copy the URL, username, and password onto the OLT.",
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not generate credentials");
    } finally {
      setBusy(false);
    }
  }

  if (!creds?.username) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-medium">ACS credentials</h2>
          <p className="mt-1 text-sm text-muted">
            Generate a unique TR-069 URL, username, and password for this ISP. Put them on the OLT so every ONU informs
            the shared ACS automatically.
          </p>
          {can.manage ? (
            <Button className="mt-4" disabled={busy} onClick={() => void generate(false)}>
              Generate ACS credentials
            </Button>
          ) : (
            <p className="mt-3 text-sm text-muted">You can view this page but cannot generate credentials.</p>
          )}
        </div>
      </div>
    );
  }

  const verifyTone = creds.last_verify_ok === true ? "ok" : creds.last_verify_ok === false ? "danger" : "muted";
  const verifyLabel =
    creds.last_verify_ok === true ? "GenieACS reachable" : creds.last_verify_ok === false ? "GenieACS unreachable" : "Not tested";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">Connection</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">ACS</dt>
              <dd>
                <Badge tone={creds.enabled ? "ok" : "muted"}>{creds.enabled ? "Enabled" : "Disabled"}</Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">GenieACS</dt>
              <dd>
                <Badge tone={verifyTone}>{verifyLabel}</Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">VPS host</dt>
              <dd className="font-mono text-xs">{creds.public_host || "Set by platform admin"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">TR-069 port</dt>
              <dd className="font-mono">{creds.cwmp_port ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Tenant</dt>
              <dd className="truncate font-mono text-xs">{creds.username || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Last verification</dt>
              <dd className="text-xs">{creds.last_verified_at ? new Date(creds.last_verified_at).toLocaleString() : "Never"}</dd>
            </div>
          </dl>
          {creds.last_verify_error ? <p className="mt-2 text-xs text-danger">{creds.last_verify_error}</p> : null}
          <p className="mt-3 text-xs text-subtle">
            NBI stays on the private network. This test pings GenieACS from the backend — it does not fetch your public
            ACS URL.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">CPE setup</h2>
          <p className="mt-1 text-sm text-muted">
            On the OLT TR-069 profile (and on a standalone router ACS page), set the values below. Connection-request
            credentials are separate from ACS login.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Copy ACS URL, username, and password onto the OLT profile.</li>
            <li>Copy connection-request username and password if the vendor has those fields.</li>
            <li>Activate the ONU, then Devices → Sync from ACS.</li>
          </ol>
          {!nbiConfigured ? (
            <p className="mt-3 text-sm text-muted">NBI is not configured yet. Devices will inform but this console cannot query GenieACS until NBI is saved.</p>
          ) : null}
        </div>
      </div>

      <CopyRow label="ACS URL" value={creds.cwmp_url} onCopy={flash} />
      {creds.alt_url ? <CopyRow label="DNS ACS URL" value={creds.alt_url} onCopy={flash} /> : null}
      <CopyRow label="Username" value={creds.username} onCopy={flash} />
      <CopyRow
        label="Password"
        value={revealed ? creds.password : ""}
        secret
        onCopy={(ok, msg) => {
          if (!revealed) {
            flash(false, "Reveal the password first, then copy.");
            return;
          }
          flash(ok, ok ? "Password copied" : msg);
        }}
      />
      <CopyRow label="Connection-request username" value={creds.connreq_user} onCopy={flash} />
      <CopyRow
        label="Connection-request password"
        value={revealed ? creds.connreq_password : ""}
        secret
        onCopy={(ok, msg) => {
          if (!revealed) {
            flash(false, "Reveal the password first, then copy.");
            return;
          }
          flash(ok, ok ? "Password copied" : msg);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            const text = `ACS URL: ${creds.cwmp_url}\nUsername: ${creds.username}\nPassword: ${revealed ? creds.password : "********"}`;
            if (!revealed) {
              flash(false, "Reveal the password first to copy the complete configuration.");
              return;
            }
            const ok = await copyText(creds.config_text || text);
            flash(ok, ok ? "ACS configuration copied" : "Copy failed — the browser blocked the clipboard");
          }}
        >
          Copy complete configuration
        </Button>
        {can.reveal ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("Reveal ACS and connection-request passwords for this ISP? This is audited.")) return;
              setBusy(true);
              try {
                const row = await revealAcsCredentialsFn();
                setCreds(row);
                setNote("Passwords visible on this screen only. They are not stored in the browser.");
              } catch (err) {
                setNote(err instanceof Error ? err.message : "Could not reveal");
              } finally {
                setBusy(false);
              }
            }}
          >
            Reveal passwords
          </Button>
        ) : null}
        {can.rotate ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void generate(true)}>
            Regenerate password
          </Button>
        ) : null}
        {can.test ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await testAcsConnectionFn();
                if (r.credentials) {
                  setCreds({
                    ...r.credentials,
                    password: creds.password,
                    connreq_password: creds.connreq_password,
                    snippets: creds.password ? creds.snippets : r.credentials.snippets,
                    config_text: creds.password ? creds.config_text : r.credentials.config_text,
                  } as Desk);
                }
                setNote(r.ok ? "GenieACS NBI is reachable." : r.error || "GenieACS NBI is not reachable.");
              } catch (err) {
                setNote(err instanceof Error ? err.message : "Test failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Test ACS connection
          </Button>
        ) : null}
      </div>

      {can.manage ? (
        <form
          className="grid max-w-3xl gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setNote(null);
            try {
              const row = await saveAcsCredentialsFn({ data: { enabled, inform_interval: inform } });
              setCreds({ ...row, password: creds.password, connreq_password: creds.connreq_password, snippets: creds.password ? creds.snippets : row.snippets, config_text: creds.password ? creds.config_text : row.config_text });
              setNote("Saved. Changing enablement or inform interval does not rewrite existing ONU account numbers or serials.");
            } catch (err) {
              setNote(err instanceof Error ? err.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="flex h-11 items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            ACS enabled for this ISP (disabled tenants are removed from the TR-069 edge listeners)
          </label>
          <Field label="Periodic inform (seconds)">
            <Input type="number" min={30} max={86400} value={inform} onChange={(e) => setInform(Number(e.target.value))} />
          </Field>
          <p className="text-xs text-subtle md:col-span-2">
            The ACS URL and port are assigned by the platform. Changing them requires a superadmin and a warning — ONUs
            keep the old URL until the OLT profile is updated.
          </p>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
      ) : null}

      <div className="space-y-3">
        <h2 className="font-medium">OLT snippets</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["huawei", "Huawei"],
              ["zte", "ZTE"],
              ["fiberhome", "Fiberhome"],
              ["params", "TR-069 parameters"],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={snippet === id ? "default" : "secondary"}
              onClick={async () => {
                if (!revealed) {
                  flash(false, "Reveal the password first so snippets include the real secret.");
                  return;
                }
                const text = creds.snippets[id];
                setSnippet(id);
                const ok = await copyText(text);
                flash(ok, ok ? `${label} snippet copied` : "Copy failed — the browser blocked the clipboard");
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        {snipText ? (
          <pre className="overflow-x-auto rounded-xl border border-border bg-bg p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {snipText}
          </pre>
        ) : (
          <p className="text-sm text-muted">Reveal passwords, then copy a vendor snippet onto the OLT TR-069 profile.</p>
        )}
      </div>
    </div>
  );
}
