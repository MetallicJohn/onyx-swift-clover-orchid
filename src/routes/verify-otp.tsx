import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { requestPasswordReset, verifyPasswordResetOtp } from "@/lib/isp/server";

export const Route = createFileRoute("/verify-otp")({
  validateSearch: (search: Record<string, unknown>): { identifier?: string } => ({
    identifier: typeof search.identifier === "string" ? search.identifier : undefined,
  }),
  component: VerifyOtp,
});

function VerifyOtp() {
  const navigate = useNavigate();
  const { identifier: fromSearch } = Route.useSearch();
  const [identifier, setIdentifier] = useState(fromSearch || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("If an account exists for the information provided, a verification code has been sent.");

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <BrandMark name={APP_NAME} size={36} />
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Enter verification code</h1>
        <p className="mt-2 text-sm text-muted">{note}</p>
        <form
          className="mt-6 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await verifyPasswordResetOtp({ data: { identifier, code } });
              await navigate({ to: "/reset-password", search: { token: r.token } });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not verify the code");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email or mobile number">
            <Input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="none" />
          </Field>
          <Field label="6-digit code">
            <Input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoComplete="one-time-code"
              name="otp"
            />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Verify code"}
          </Button>
        </form>
        <button
          type="button"
          className="mt-4 text-sm text-muted hover:text-fg"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await requestPasswordReset({ data: { identifier } });
              setNote("If an account exists for the information provided, a verification code has been sent.");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not resend");
            } finally {
              setBusy(false);
            }
          }}
        >
          Resend code
        </button>
        <div>
          <Link to="/forgot-password" className="mt-4 inline-flex h-11 items-center text-sm text-accent hover:underline">
            Use a different email or number
          </Link>
        </div>
        <Link to="/reset-password" className="mt-2 inline-flex h-11 items-center text-sm text-muted hover:underline">
          Use email reset instead
        </Link>
      </div>
    </main>
  );
}
