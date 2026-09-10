import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { completePasswordReset, requestPasswordReset } from "@/lib/isp/server";

export const Route = createFileRoute("/reset-password")({ component: ResetPassword });

function ResetPassword() {
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const token = useMemo(() => new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("token") ?? "", [search]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const r = await requestPasswordReset({ data: { email } });
      setMessage(r.message);
      if (r.hint) setHint(r.hint);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset");
    } finally {
      setBusy(false);
    }
  }

  async function onComplete(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completePasswordReset({ data: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-md bg-accent text-accent-fg">
            <Activity className="size-4" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        {done ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
            <p className="mt-2 text-sm text-muted">Sign in with your email and the new password. This covers ISP consoles and superadmin.</p>
            <Link to="/login" className="mt-6 inline-flex h-11 items-center text-sm text-accent hover:underline">
              Back to sign in
            </Link>
          </>
        ) : token ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
            <p className="mt-2 text-sm text-muted">Choose a password for this {APP_NAME} login. At least 8 characters.</p>
            <form className="mt-6 grid gap-3" onSubmit={onComplete}>
              <Field label="New password">
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm">
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Update password"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Forgot password</h1>
            <p className="mt-2 text-sm text-muted">
              ISP owners, staff, and the {APP_NAME} superadmin use the same email login. We email a reset link when SMTP is configured.
            </p>
            <form className="mt-6 grid gap-3" onSubmit={onRequest}>
              <Field label="Email">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </Field>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              {message ? <p className="text-sm text-ok">{message}</p> : null}
              {hint ? (
                <p className="text-sm text-muted">
                  Email is queued. Use this link in this workspace:{" "}
                  <a href={hint} className="text-accent hover:underline">
                    Open reset
                  </a>
                </p>
              ) : null}
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            </form>
            <Link to="/login" className="mt-4 inline-flex h-11 items-center text-sm text-muted hover:text-fg">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
