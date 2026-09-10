import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { usePublicTheme } from "@/components/theme-provider";
import { APP_NAME } from "@/lib/brand";
import { getResellerHome, requestResellerOtp, verifyResellerLogin } from "@/lib/isp/server-ops";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/reseller/")({ component: ResellerHome });

function ResellerHome() {
  const [slug, setSlug] = useState("");
  const [debounced, setDebounced] = useState("");
  const { branding } = usePublicTheme(debounced, "reseller");
  const brandName = branding?.displayName || APP_NAME;
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [home, setHome] = useState<Awaited<ReturnType<typeof getResellerHome>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(slug.trim()), 400);
    return () => clearTimeout(t);
  }, [slug]);

  if (!token || !home) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
        <Link to="/" className="mb-8 flex items-center gap-2 text-sm text-muted">
          <BrandMark name={brandName} logo={branding?.logo} size={20} /> {brandName} reseller
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Commission wallet</h1>
        <p className="mt-2 text-sm text-muted">ISP slug + the phone on your reseller record. Sandbox code is 000000.</p>
        <form
          className="mt-6 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              if (!hint) {
                const r = await requestResellerOtp({ data: { slug, phone } });
                setHint(r.hint);
              } else {
                const r = await verifyResellerLogin({ data: { slug, phone, code } });
                setToken(r.token);
                setHome(await getResellerHome({ data: { token: r.token } }));
              }
            } catch (ex) {
              setError(ex instanceof Error ? ex.message : "Failed");
            }
          }}
        >
          <Field label="ISP slug">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="imani" required />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>
          {hint ? (
            <Field label="OTP">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={hint} required />
            </Field>
          ) : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit">{hint ? "Sign in" : "Send code"}</Button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <p className="text-xs text-muted">{home.isp.name}</p>
      <h1 className="text-2xl font-semibold">{home.reseller.name}</h1>
      <p className="mt-1 text-sm text-muted">{home.reseller.commission_pct}% commission</p>
      <p className="mt-4 font-mono text-3xl">{kes(home.balance)}</p>
      <section className="mt-8">
        <h2 className="mb-2 font-medium">Customers</h2>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {home.customers.map((c) => (
            <li key={c.id} className="flex justify-between px-4 py-3 text-sm">
              <span>{c.name}</span>
              <span className="text-muted">{c.status}</span>
            </li>
          ))}
          {home.customers.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No attached customers yet.</li> : null}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="mb-2 font-medium">Wallet</h2>
        <ul className="text-sm">
          {home.txs.map((t, i) => (
            <li key={i} className="flex justify-between py-1">
              <span className="text-muted">{t.reason}</span>
              <span className="font-mono">{kes(t.delta_kes)}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
