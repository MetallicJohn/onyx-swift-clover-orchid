import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { EmptyState, PasswordBanner, PortalCard, StatTile, SupportLine } from "@/components/isp/portal-ui";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { usePublicTheme } from "@/components/theme-provider";
import { APP_NAME } from "@/lib/brand";
import { accountStatusLabel } from "@/lib/isp/customer-portal-format";
import { formatDate } from "@/lib/isp/display";
import { readPortalSession, readPortalSlug, writePortalSession } from "@/lib/isp/portal-session";
import {
  completePortalPasswordResetFn,
  portalChangePassword,
  portalPasswordSignIn,
  requestPortalOtp,
  verifyPortalLogin,
} from "@/lib/isp/server-portal";
import { kes } from "@/lib/utils";
import { usePortal } from "../portal";

export const Route = createFileRoute("/portal/")({
  component: PortalIndex,
});

function PortalIndex() {
  const session = readPortalSession();
  if (session?.token) return <Dashboard />;
  return <PortalLogin />;
}

function PortalLogin() {
  const initialSlug =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("slug") || readPortalSlug() : readPortalSlug();
  const [slug, setSlug] = useState(initialSlug);
  const [debounced, setDebounced] = useState(slug);
  const { branding } = usePublicTheme(debounced, "portal");
  const brandName = branding?.displayName || APP_NAME;
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"password" | "otp" | "reset">("password");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offerPassword, setOfferPassword] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(slug.trim()), 400);
    return () => clearTimeout(t);
  }, [slug]);

  function goHome() {
    window.location.assign("/portal/");
  }

  async function opened(nextToken: string, usingInitial?: boolean) {
    writePortalSession({ token: nextToken, slug: slug.trim() });
    if (usingInitial) {
      setToken(nextToken);
      setPassword("");
      setConfirm("");
      setOfferPassword(true);
      return;
    }
    goHome();
  }

  if (offerPassword) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Set a stronger password?</h1>
        <p className="mt-2 text-sm text-muted">
          You signed in with your phone number as the default password. Changing it is recommended, not required. You can skip this and change it later under Profile.
        </p>
        <form
          className="mt-6 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (password !== confirm) {
              setError("Passwords do not match");
              return;
            }
            setBusy(true);
            try {
              await portalChangePassword({ data: { token, current: phone, password } });
              goHome();
            } catch (ex) {
              setError(ex instanceof Error ? ex.message : "Could not update password");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="New password">
            <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm">
            <Input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            Save password and continue
          </Button>
          <Button type="button" variant="ghost" onClick={goHome}>
            Skip for now
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted">
        <BrandMark name={brandName} logo={branding?.logo} size={20} /> {brandName}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Customer portal</h1>
      <p className="mt-2 text-sm text-muted">
        Sign in with the phone on your account. The first password is that same phone number. Changing it is recommended, not required.
      </p>
      <div className="mt-5 flex gap-2">
        {(["password", "otp", "reset"] as const).map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? "default" : "secondary"}
            onClick={() => {
              setMode(m);
              setError(null);
              setHint(null);
            }}
          >
            {m === "password" ? "Password" : m === "otp" ? "SMS code" : "Reset"}
          </Button>
        ))}
      </div>
      <form
        className="mt-6 grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            if (mode === "password") {
              const r = await portalPasswordSignIn({ data: { slug, phone, password } });
              await opened(r.token, r.using_initial_password);
              return;
            }
            if (mode === "otp") {
              if (!hint) {
                const r = await requestPortalOtp({ data: { slug, phone } });
                setHint(r.hint);
              } else {
                const r = await verifyPortalLogin({ data: { slug, phone, code } });
                await opened(r.token, r.using_initial_password);
              }
              return;
            }
            if (!hint) {
              const r = await requestPortalOtp({ data: { slug, phone } });
              setHint(r.hint);
              return;
            }
            if (password !== confirm) throw new Error("Passwords do not match");
            const r = await completePortalPasswordResetFn({ data: { slug, phone, code, password } });
            await opened(r.token, false);
          } catch (ex) {
            setError(ex instanceof Error ? ex.message : "Could not sign in");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Network">
          <Input required placeholder="your ISP slug" value={slug} onChange={(e) => setSlug(e.target.value)} autoComplete="organization" />
        </Field>
        <Field label="Phone number (username)">
          <Input required placeholder="0712…" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="username" inputMode="tel" />
        </Field>
        {mode === "password" ? (
          <Field label="Password">
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Your phone number, unless you changed it"
            />
          </Field>
        ) : null}
        {mode !== "password" && hint ? (
          <Field label="SMS code">
            <Input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" />
          </Field>
        ) : null}
        {mode !== "password" && hint ? <p className="text-xs text-muted">{hint}</p> : null}
        {mode === "reset" && hint ? (
          <>
            <Field label="New password">
              <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Confirm">
              <Input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
          </>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          {mode === "password" ? "Sign in" : !hint ? "Send code" : mode === "reset" ? "Save password and open" : "Open account"}
        </Button>
      </form>
    </main>
  );
}

function Dashboard() {
  const { home, refresh } = usePortal();
  const navigate = useNavigate();
  const [hidePw, setHidePw] = useState(() => sessionStorage.getItem("isp.portal.pw-banner") === "1");
  const d = home.dashboard;
  const unpaid = home.invoices.filter((i) => i.balance_kes > 0);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs tracking-wide text-muted uppercase">Account {home.customer.account_number || "—"}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{home.customer.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{home.customer.phone}</span>
          <Badge tone={statusTone(home.customer.account_status)}>{accountStatusLabel(home.customer.account_status)}</Badge>
          <span className="text-xs text-subtle">Account status</span>
        </div>
      </div>

      {d.using_initial_password && !hidePw ? (
        <PasswordBanner
          onChange={() => void navigate({ to: "/portal/profile" as never })}
          onDismiss={() => {
            sessionStorage.setItem("isp.portal.pw-banner", "1");
            setHidePw(true);
          }}
        />
      ) : null}

      <PortalCard title="Services">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Total" value={String(d.services_total)} hint={`${d.services_active} active`} />
          <StatTile label="Grace Period" value={String(d.services_grace)} tone={d.services_grace ? "warn" : "muted"} />
          <StatTile label="Expired" value={String(d.services_expired)} tone={d.services_expired ? "danger" : "muted"} />
          <StatTile label="Suspended" value={String(d.services_suspended)} tone={d.services_suspended ? "warn" : "muted"} />
        </div>
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => void navigate({ to: "/portal/services" as never })}>
          My services
        </Button>
      </PortalCard>

      <PortalCard title="Billing">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            label="Outstanding"
            value={kes(d.outstanding_kes)}
            tone={d.outstanding_kes > 0 ? "danger" : "ok"}
            hint={`${d.unpaid_invoices} unpaid invoice${d.unpaid_invoices === 1 ? "" : "s"}`}
          />
          <StatTile label="Next renewal" value={d.next_renewal ? formatDate(d.next_renewal) : "—"} />
          <StatTile
            label="Latest payment"
            value={d.latest_payment ? kes(d.latest_payment.amount_kes) : "—"}
            hint={d.latest_payment ? `${d.latest_payment.method} · ${formatDate(d.latest_payment.paid_at)}` : "No payments yet"}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="min-h-12 flex-1 sm:flex-none" onClick={() => void navigate({ to: "/portal/pay" as never })} disabled={d.outstanding_kes <= 0}>
            Pay now
          </Button>
          <Button variant="secondary" onClick={() => void navigate({ to: "/portal/invoices" as never })}>
            Invoices
          </Button>
          <Button variant="ghost" onClick={() => void navigate({ to: "/portal/payments" as never })}>
            Payments
          </Button>
        </div>
      </PortalCard>

      <PortalCard
        title="Open tickets"
        action={
          <Button size="sm" variant="secondary" onClick={() => void navigate({ to: "/portal/tickets" as never })}>
            Support
          </Button>
        }
      >
        <p className="text-sm text-muted">
          {d.open_tickets === 0 ? "No open tickets." : `${d.open_tickets} open ticket${d.open_tickets === 1 ? "" : "s"}.`}
        </p>
      </PortalCard>

      {unpaid.length ? (
        <PortalCard title="Unpaid invoices">
          <ul>
            {unpaid.slice(0, 3).map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {inv.number}
                  <span className="block text-xs text-muted">
                    {inv.package_name} · due {formatDate(inv.due_date)}
                  </span>
                </span>
                <span className="tabular-nums font-medium">{kes(inv.balance_kes)}</span>
              </li>
            ))}
          </ul>
        </PortalCard>
      ) : (
        <EmptyState title="You are up to date" body="There is nothing to pay on this account." />
      )}

      <SupportLine phone={home.isp.support_phone} email={home.isp.support_email} />
      <button type="button" className="text-xs text-subtle" onClick={() => void refresh()}>
        Refresh
      </button>
    </div>
  );
}
