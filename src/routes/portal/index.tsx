import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { getPortalHome, portalOpenTicket, portalPay, requestPortalOtp, verifyPortalLogin } from "@/lib/isp/server-ops";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/portal/")({ component: PortalHome });

function PortalHome() {
  const [slug, setSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [home, setHome] = useState<Awaited<ReturnType<typeof getPortalHome>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState("");

  async function refresh(t: string) {
    setHome(await getPortalHome({ data: { token: t } }));
  }

  if (!token || !home) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted">
          <Activity className="size-4 text-accent" /> Gridline customer portal
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Pay bills & check your line</h1>
        <p className="mt-2 text-sm text-muted">Use your ISP slug and the phone on the account. Sandbox SMS uses code 000000; live SMS is sent to the phone.</p>
        <form
          className="mt-6 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              if (!hint) {
                const r = await requestPortalOtp({ data: { slug, phone } });
                setHint(r.hint);
              } else {
                const r = await verifyPortalLogin({ data: { slug, phone, code } });
                setToken(r.token);
                await refresh(r.token);
              }
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
          {hint ? (
            <Field label="OTP">
              <Input required value={code} onChange={(e) => setCode(e.target.value)} placeholder={hint} />
            </Field>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit">{hint ? "Open account" : "Send code"}</Button>
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
          }}
        >
          Sign out
        </Button>
      </div>

      <section className="mt-8 space-y-3">
        <h2 className="font-medium">Services</h2>
        {home.services.map((s, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
            <div>
              <div>{s.package_name}</div>
              <div className="text-xs text-muted">
                {s.access_method} · {s.username}
              </div>
            </div>
            <Badge tone={statusTone(s.status)}>{s.status}</Badge>
          </div>
        ))}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="font-medium">Invoices</h2>
        {home.invoices.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
            <div>
              <div className="font-mono text-sm">{inv.number}</div>
              <div className="text-xs text-muted">Due {inv.due_date}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{kes(inv.remaining_kes ?? inv.amount_kes)}</span>
              {inv.status === "paid" || (inv.remaining_kes ?? 0) <= 0 ? (
                <Badge tone="ok">paid</Badge>
              ) : (
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!token) return;
                    await portalPay({ data: { token, invoice_id: inv.id } });
                    await refresh(token);
                  }}
                >
                  Pay M-Pesa
                </Button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="font-medium">Messages</h2>
        {home.inbox?.length
          ? home.inbox.map((m) => (
              <div key={m.id} className="rounded-xl border border-border bg-surface px-4 py-3">
                <div className="font-medium">{m.subject}</div>
                <p className="mt-1 text-sm text-muted">{m.body}</p>
              </div>
            ))
          : (
            <p className="text-sm text-muted">No messages yet.</p>
          )}
      </section>

      <form
        className="mt-8 grid gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!token) return;
          await portalOpenTicket({ data: { token, title: ticket } });
          setTicket("");
        }}
      >
        <h2 className="font-medium">Need help?</h2>
        <Field label="Describe the issue">
          <Input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="No internet since evening…" />
        </Field>
        <Button type="submit">Open ticket</Button>
      </form>
    </main>
  );
}
