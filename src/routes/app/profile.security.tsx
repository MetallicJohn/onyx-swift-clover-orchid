import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { changeMyPassword, revokeMySessions } from "@/lib/isp/server";

export const Route = createFileRoute("/app/profile/security")({ component: SecurityPage });

function SecurityPage() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted">Change your password or sign out of every device.</p>
        <Link to="/app/profile" className="mt-2 inline-flex text-sm text-accent hover:underline">
          Back to profile
        </Link>
      </div>
      <form
        className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) {
            setError("Passwords do not match");
            return;
          }
          setBusy(true);
          setError(null);
          setOk(null);
          try {
            await changeMyPassword({ data: { current, password } });
            setCurrent("");
            setPassword("");
            setConfirm("");
            setOk("Password updated");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not change password");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Current password">
          <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password">
          <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {ok ? <p className="text-sm text-ok">{ok}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
      <div className="max-w-xl rounded-xl border border-border bg-surface p-4">
        <h2 className="text-base font-semibold">Sign out everywhere</h2>
        <p className="mt-1 text-sm text-muted">Invalidates every session for this login, including this browser.</p>
        <Button
          type="button"
          variant="danger"
          className="mt-3"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await revokeMySessions();
              window.location.assign("/login");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not revoke sessions");
              setBusy(false);
            }
          }}
        >
          Logout all sessions
        </Button>
      </div>
    </div>
  );
}
