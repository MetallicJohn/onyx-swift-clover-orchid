import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { addReferral, addReseller, listPartners } from "@/lib/isp/server-ops";
import { linkReseller, redeemPoints } from "@/lib/isp/server-more";

export const Route = createFileRoute("/app/partners")({ component: PartnersPage });

function PartnersPage() {
  const [tab, setTab] = useState<"loyalty" | "referrals" | "resellers">("loyalty");
  const [data, setData] = useState<Awaited<ReturnType<typeof listPartners>> | null>(null);
  const [ref, setRef] = useState({ referrer_id: "", referee_name: "", referee_phone: "" });
  const [rs, setRs] = useState({ name: "", phone: "", commission_pct: 10 });

  async function load() {
    const r = await listPartners();
    setData(r);
    if (!ref.referrer_id && r.customers[0]) setRef((f) => ({ ...f, referrer_id: r.customers[0].id }));
  }
  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <p className="text-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Partners</h1>
        <p className="text-sm text-muted">Loyalty points accrue on payment. Referrals and resellers are separate modules.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["loyalty", "referrals", "resellers"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "secondary"} onClick={() => setTab(t)}>
            {t}
          </Button>
        ))}
      </div>

      {tab === "loyalty" ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {data.loyalty.map((l) => (
            <li key={l.phone} className="flex items-center justify-between bg-surface px-4 py-3">
              <div>
                <div className="font-medium">{l.customer_name}</div>
                <div className="text-xs text-muted">{l.phone}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-mono">{l.points} pts</div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await redeemPoints({ data: { customer_id: l.customer_id, points: Math.min(100, l.points) } });
                    await load();
                  }}
                >
                  Redeem 100
                </Button>
              </div>
            </li>
          ))}
          {data.loyalty.length === 0 ? <li className="px-4 py-6 text-sm text-muted">Points appear after confirmed payments.</li> : null}
        </ul>
      ) : null}

      {tab === "referrals" ? (
        <div className="space-y-4">
          <form
            className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await addReferral({ data: ref });
              setRef({ ...ref, referee_name: "", referee_phone: "" });
              await load();
            }}
          >
            <Field label="Referrer">
              <Select value={ref.referrer_id} onChange={(e) => setRef({ ...ref, referrer_id: e.target.value })}>
                {data.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="New customer">
              <Input required value={ref.referee_name} onChange={(e) => setRef({ ...ref, referee_name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={ref.referee_phone} onChange={(e) => setRef({ ...ref, referee_phone: e.target.value })} />
            </Field>
            <Button type="submit">Log referral</Button>
          </form>
          <ul className="space-y-2">
            {data.referrals.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
                <div>
                  <div className="font-medium">{r.referee_name}</div>
                  <div className="text-xs text-muted">via {r.referrer}</div>
                </div>
                <Badge tone={statusTone(r.status)}>{r.points} pts · {r.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "resellers" ? (
        <div className="space-y-4">
          <form
            className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await addReseller({ data: rs });
              setRs({ name: "", phone: "", commission_pct: 10 });
              await load();
            }}
          >
            <Field label="Name">
              <Input required value={rs.name} onChange={(e) => setRs({ ...rs, name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={rs.phone} onChange={(e) => setRs({ ...rs, phone: e.target.value })} />
            </Field>
            <Field label="Commission %">
              <Input type="number" value={rs.commission_pct} onChange={(e) => setRs({ ...rs, commission_pct: Number(e.target.value) })} />
            </Field>
            <Button type="submit">Add reseller</Button>
          </form>
          <div className="grid gap-3 md:grid-cols-2">
            {data.resellers.map((r) => (
              <article key={r.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="font-medium">{r.name}</div>
                <p className="text-sm text-muted">{r.phone} · {r.commission_pct}% · wallet KES {r.balance_kes ?? 0}</p>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
