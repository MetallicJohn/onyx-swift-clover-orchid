import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { downloadPdf } from "@/lib/isp/pdf-client";
import { portalInvoicePdf, portalStatementPdf } from "@/lib/isp/server-docs";
import {
  completePortalPasswordResetFn,
  getPortalHome,
  portalChangePassword,
  portalOpenTicket,
  portalPasswordSignIn,
  portalPay,
  requestPortalOtp,
  verifyPortalLogin,
} from "@/lib/isp/server-ops";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/portal/")({ component: PortalHome });

function PortalHome() {
  const [slug, setSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mode, setMode] = useState<"password" | "otp" | "reset">("password");
  const [hint, setHint] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [home, setHome] = useState<Awaited<ReturnType<typeof getPortalHome>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState("");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  async function refresh(t: string) {
    setHome(await getPortalHome({ data: { token: t } }));
  }

  if (!token || !home) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted">
          <Activity className="size-4 text-accent" /> {APP_NAME} customer portal
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Pay bills & check your line</h1>
        <p className="mt-2 text-sm text-muted">
          Sign in with the phone on your account. Use a portal password, or an SMS code.
        </p>
        <div className="mt-5 flex gap-2">
          <Button size="sm" variant={mode === "password" ? "default" : "secondary"} onClick={() => { setMode("password"); setError(null); }}>
            Password
          </Button>
          <Button size="sm" variant={mode === "otp" ? "default" : "secondary"} onClick={() => { setMode("otp"); setError(null); }}>
            SMS code
          </Button>
          <Button size="sm" variant={mode === "reset" ? "default" : "secondary"} onClick={() => { setMode("reset"); setError(null); }}>
            Reset
          </Button>
        </div>
        <form
          className="mt-6 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              if (mode === "password") {
                const r = await portalPasswordSignIn({ data: { slug, phone, password } });
                setToken(r.token);
                await refresh(r.token);
                return;
              }
              if (mode === "otp") {
                if (!hint) {
                  const r = await requestPortalOtp({ data: { slug, phone } });
                  setHint(r.hint);
                } else {
                  const r = await verifyPortalLogin({ data: { slug, phone, code } });
                  setToken(r.token);
                  await refresh(r.token);
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
              setToken(r.token);
              await refresh(r.token);
            } catch (ex) {
              setError(ex instanceof Error ? ex.message : "Failed");
            }
          }}
        >
          <Field label="Network slug">
            <Input required placeholder="from Settings / your ISP URL" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input required placeholder="0712…" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {mode === "password" ? (
            <Field label="Portal password">
              <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : null}
          {mode !== "password" && hint ? (
            <Field label="SMS code">
              <Input required value={code} onChange={(e) => setCode(e.target.value)} placeholder={hint} />
            </Field>
          ) : null}
          {mode === "reset" && hint ? (
            <>
              <Field label="New portal password">
                <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Confirm">
                <Input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
            </>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit">
            {mode === "password"
              ? "Sign in"
              : !hint
                ? "Send code"
                : mode === "reset"
                  ? "Save password and open"
                  : "Open account"}
          </Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-accent uppercase">{home.isp.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{home.customer.name}</h1>
          <p className="text-sm text-muted">{home.customer.phone} · {home.points} loyalty points</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setToken(null);
            setHome(null);
            setHint(null);
            setPassword("");
            setCode("");
          }}
        >
          Sign out
        </Button>
      </div>
      <section className="mt-8 rounded-xl bg-surface p-5 shadow-card">
        <h2 className="font-medium">Services</h2>
        <ul className="mt-3 divide-y divide-border">
          {home.services.map((s, i) => (
            <li key={`${s.username}-${i}`} className="flex items-center justify-between py-3 text-sm">
              <span>
                {s.package_name} · {s.access_method}
              </span>
              <Badge tone={statusTone(s.status)}>{s.status}</Badge>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-4 rounded-xl bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Invoices</h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const file = await portalStatementPdf({ data: { token } });
              downloadPdf(file);
            }}
          >
            Statement PDF
          </Button>
        </div>
        <ul className="mt-3 divide-y divide-border">
          {home.invoices.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div>
                <div>{inv.number}</div>
                <div className="text-xs text-muted">due {inv.due_date}</div>
              </div>
              <div className="text-right">
                <div className="font-mono">{kes(inv.remaining_kes)}</div>
                <div className="mt-1 flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const file = await portalInvoicePdf({ data: { token, id: inv.id } });
                      downloadPdf(file);
                    }}
                  >
                    PDF
                  </Button>
                  {inv.status !== "paid" ? (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await portalPay({ data: { token, invoice_id: inv.id } });
                        await refresh(token);
                      }}
                    >
                      Pay
                    </Button>
                  ) : (
                    <Badge tone="ok">paid</Badge>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <form
        className="mt-4 grid gap-3 rounded-xl bg-surface p-5 shadow-card"
        onSubmit={async (e) => {
          e.preventDefault();
          await portalOpenTicket({ data: { token, title: ticket } });
          setTicket("");
          await refresh(token);
        }}
      >
        <Field label="Open a ticket">
          <Input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="Describe the issue" />
        </Field>
        <Button type="submit">Send</Button>
      </form>
      <form
        className="mt-4 grid gap-3 rounded-xl bg-surface p-5 shadow-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setPwMsg(null);
          setError(null);
          if (pw.next !== pw.confirm) {
            setError("Passwords do not match");
            return;
          }
          try {
            await portalChangePassword({ data: { token, current: pw.current, password: pw.next } });
            setPw({ current: "", next: "", confirm: "" });
            setPwMsg("Portal password updated. Use it next time you sign in.");
          } catch (ex) {
            setError(ex instanceof Error ? ex.message : "Could not change password");
          }
        }}
      >
        <h2 className="font-medium">Portal password</h2>
        <p className="text-sm text-muted">Change the password for this phone, or set one if you only used SMS before.</p>
        <Field label="Current (blank if you never set one)">
          <Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </Field>
        <Field label="New password">
          <Input type="password" required minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </Field>
        <Field label="Confirm">
          <Input type="password" required minLength={8} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </Field>
        {pwMsg ? <p className="text-sm text-ok">{pwMsg}</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit">Update portal password</Button>
      </form>
      {home.inbox.length > 0 ? (
        <section className="mt-4 rounded-xl bg-surface p-5 shadow-card">
          <h2 className="font-medium">Messages</h2>
          <ul className="mt-3 divide-y divide-border text-sm">
            {home.inbox.map((m) => (
              <li key={m.id} className="py-3">
                <div>{m.subject}</div>
                <div className="mt-1 text-xs text-muted">{m.body}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
