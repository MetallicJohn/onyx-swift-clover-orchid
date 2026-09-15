import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorBanner, PortalCard, SupportLine } from "@/components/isp/portal-ui";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { accountStatusLabel } from "@/lib/isp/customer-portal-format";
import { portalChangePassword } from "@/lib/isp/server-portal";
import { usePortal } from "../portal";

export const Route = createFileRoute("/portal/profile")({ component: PortalProfile });

function PortalProfile() {
  const { home, token, signOut, refresh } = usePortal();
  const c = home.customer;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile & security</h1>
        <p className="mt-1 text-sm text-muted">Your account details and portal password.</p>
      </div>

      <PortalCard title="Account">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Name</dt>
            <dd className="font-medium">{c.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Account number</dt>
            <dd className="font-mono">{c.account_number || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Phone / username</dt>
            <dd>{c.phone}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Email</dt>
            <dd>{c.email || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Status</dt>
            <dd>
              <Badge tone={statusTone(c.account_status)}>{accountStatusLabel(c.account_status)}</Badge>
            </dd>
          </div>
        </dl>
      </PortalCard>

      {c.using_initial_password ? (
        <p className="rounded-xl bg-warn/10 px-4 py-3 text-sm">
          You are still using the default password (your phone number). Changing it is recommended for security, but you can keep using the portal without changing it.
        </p>
      ) : null}

      <PortalCard title="Change password">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setMsg(null);
            if (next !== confirm) {
              setError("Passwords do not match");
              return;
            }
            try {
              await portalChangePassword({ data: { token, current, password: next } });
              setCurrent("");
              setNext("");
              setConfirm("");
              setMsg("Password updated. Use it the next time you sign in.");
              await refresh();
            } catch (ex) {
              setError(ex instanceof Error ? ex.message : "Could not change password");
            }
          }}
        >
          <Field label={c.using_initial_password ? "Current (your phone number)" : "Current password"}>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password">
            <Input type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm">
            <Input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          {error ? <ErrorBanner message={error} /> : null}
          {msg ? <p className="text-sm text-ok">{msg}</p> : null}
          <Button type="submit">Update password</Button>
        </form>
      </PortalCard>

      <SupportLine phone={home.isp.support_phone} email={home.isp.support_email} />
      <Button variant="ghost" onClick={signOut}>
        Log out
      </Button>
    </div>
  );
}
