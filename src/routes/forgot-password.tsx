import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { requestPasswordReset } from "@/lib/isp/server";

export const Route = createFileRoute("/forgot-password")({ component: ForgotPassword });

function ForgotPassword() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <BrandMark name={APP_NAME} size={36} />
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Forgot password</h1>
        <p className="mt-2 text-sm text-muted">
          Enter the email or mobile number on your login. If an account exists, we send a verification code by SMS.
        </p>
        <form
          className="mt-6 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await requestPasswordReset({ data: { identifier } });
              await navigate({
                to: "/verify-otp",
                search: { identifier },
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not send the code");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email or mobile number">
            <Input
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              name="identifier"
              placeholder="you@isp.co.ke or 0712 000 000"
            />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send verification code"}
          </Button>
        </form>
        <Link to="/login" className="mt-6 inline-flex h-11 items-center text-sm text-accent hover:underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
