import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

type CatalogPackage = {
  id: string;
  name: string;
  description: string;
  price_kes: number;
  download_mbps: number;
  upload_mbps: number;
  bundle_mb: number;
  duration_label: string;
};

type Purchase = {
  id: string;
  payment_status: string;
  note: string;
  package_name: string;
  amount_kes: number;
  duration_label?: string;
  username?: string;
  password?: string;
  activated_at?: string | null;
  expires_at?: string | null;
  error?: string;
};

export const Route = createFileRoute("/wifi/$slug")({
  component: WifiBuyPage,
});

function capLabel(mb: number) {
  if (!mb) return "";
  if (mb % 1024 === 0) return `${mb / 1024} GB`;
  return `${mb} MB`;
}

function stamp(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso)
      .toLocaleString("en-GB", {
        timeZone: "Africa/Nairobi",
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      .replace(",", "");
  } catch {
    return iso;
  }
}

function WifiBuyPage() {
  const { slug } = Route.useParams();
  const [name, setName] = useState("Wi-Fi");
  const [packages, setPackages] = useState<CatalogPackage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogPackage | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Purchase | null>(null);

  useEffect(() => {
    fetch(`/api/v1/hotspot/catalog?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setName(d.name || "Wi-Fi");
        setPackages(d.packages || []);
      })
      .catch((ex) => setError(ex instanceof Error ? ex.message : "Could not load packages"));
  }, [slug]);

  async function pay() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const started = (await (
        await fetch("/api/v1/hotspot/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, package_id: selected.id, phone }),
        })
      ).json()) as Purchase;
      if (started.error) throw new Error(started.error);
      setResult(started);
      let last = started;
      for (let i = 0; i < 48; i += 1) {
        await new Promise((r) => setTimeout(r, 2500));
        const poll = (await (
          await fetch(`/api/v1/hotspot/purchase-status?slug=${encodeURIComponent(slug)}&id=${encodeURIComponent(started.id)}`)
        ).json()) as Purchase;
        last = poll;
        setResult(poll);
        if (poll.payment_status === "confirmed" || poll.payment_status === "failed" || poll.payment_status === "cancelled" || poll.payment_status === "reversed") {
          break;
        }
      }
      if (last.payment_status === "pending") {
        setResult({ ...last, payment_status: "failed", note: "The M-Pesa prompt timed out. You can try again." });
      }
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  const confirmed = result?.payment_status === "confirmed";
  const failed = result && result.payment_status !== "pending" && !confirmed;

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-[#0a0e13] px-4 py-8 text-[#e8eef4]">
      <h1 className="text-center text-xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-1 text-center text-sm text-white/60">Buy Wi-Fi with M-Pesa</p>
      {error ? <p className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200">{error}</p> : null}
      <div className="mt-6 grid gap-3">
        {packages.map((p) => (
          <article key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-white/60">
                  Valid for {p.duration_label}
                  {p.download_mbps ? ` · ${p.download_mbps} Mbps` : ""}
                  {p.bundle_mb ? ` · ${capLabel(p.bundle_mb)}` : ""}
                </p>
                {p.description ? <p className="mt-1 text-sm text-white/50">{p.description}</p> : null}
              </div>
              <p className="font-semibold">KSh {p.price_kes}</p>
            </div>
            <button
              type="button"
              className="mt-3 h-11 w-full rounded-xl bg-[#4aa8a0] text-sm font-semibold text-[#061014]"
              onClick={() => {
                setSelected(p);
                setResult(null);
                setError(null);
              }}
            >
              BUY
            </button>
          </article>
        ))}
      </div>
      {selected ? (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/55 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121820] p-5">
            <h2 className="text-lg font-semibold">Buy {selected.name}</h2>
            <p className="mt-1 text-sm text-white/65">
              KSh {selected.price_kes} · {selected.duration_label}
              {selected.download_mbps ? ` · ${selected.download_mbps} Mbps` : ""}
            </p>
            {confirmed ? (
              <div className="mt-4 space-y-2 text-sm">
                <p className="font-medium text-[#4aa8a0]">Payment Successful</p>
                <p>Package: {result.package_name}</p>
                <p>Amount: KSh {result.amount_kes}</p>
                {result.activated_at ? <p>Activated: {stamp(result.activated_at)}</p> : null}
                {result.expires_at ? <p>Expires: {stamp(result.expires_at)}</p> : null}
                {result.username ? (
                  <div className="rounded-xl bg-white/5 px-3 py-2 font-mono text-sm">
                    Username: {result.username}
                    <br />
                    Password: {result.password}
                  </div>
                ) : null}
                <p className="text-white/65">Sign in with these credentials to get online.</p>
              </div>
            ) : failed ? (
              <p className="mt-4 text-sm text-red-200">{result.note}</p>
            ) : result?.payment_status === "pending" ? (
              <p className="mt-4 text-sm text-white/70">
                <strong className="block text-[#e8eef4]">M-Pesa payment request sent</strong>
                Check your phone and enter your M-Pesa PIN to complete the payment.
              </p>
            ) : (
              <label className="mt-4 block text-sm">
                M-Pesa phone
                <input
                  className="mt-1 h-11 w-full rounded-xl border border-white/15 bg-white/5 px-3"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07XXXXXXXX"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </label>
            )}
            <div className="mt-4 flex gap-2">
              <button type="button" className="h-11 flex-1 rounded-xl border border-white/15" onClick={() => setSelected(null)}>
                {confirmed ? "Close" : "Cancel"}
              </button>
              {confirmed ? null : (
                <button
                  type="button"
                  className="h-11 flex-1 rounded-xl bg-[#4aa8a0] font-semibold text-[#061014]"
                  disabled={busy}
                  onClick={() => void pay()}
                >
                  {busy ? "Waiting…" : failed ? "Retry" : "Pay now"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
