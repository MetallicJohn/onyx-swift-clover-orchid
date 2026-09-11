import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { getPublicSite, submitPublicInquiry } from "@/lib/isp/server-platform";
import { LandingSupportNote } from "./sections";

const TOPICS = [
  { id: "sales", label: "Sales" },
  { id: "support", label: "Technical support" },
  { id: "partnership", label: "Partnership / reseller" },
] as const;

export function LandingContact() {
  const [contact, setContact] = useState({ sales_email: "", support_email: "", contact_phone: "" });
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    topic: "sales",
    message: "",
    website: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    getPublicSite()
      .then(setContact)
      .catch(() => setContact({ sales_email: "", support_email: "", contact_phone: "" }));
  }, []);

  const hasDetails = Boolean(contact.sales_email || contact.support_email || contact.contact_phone);

  return (
    <section id="contact" className="scroll-mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[0.9fr_1.1fr] md:py-24">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-accent uppercase">Contact</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Have a question about how this fits your network?</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted md:text-base">
            Need help getting started, or want to walk through billing and MikroTik against a real site? Send a
            message. Direct numbers and inboxes only appear here when they have been set.
          </p>
          {hasDetails ? (
            <dl className="mt-8 grid gap-4 text-sm">
              {contact.sales_email ? (
                <div>
                  <dt className="text-xs tracking-wide text-subtle uppercase">Sales</dt>
                  <dd className="mt-1">
                    <a className="text-fg hover:text-accent" href={`mailto:${contact.sales_email}`}>
                      {contact.sales_email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {contact.support_email ? (
                <div>
                  <dt className="text-xs tracking-wide text-subtle uppercase">Technical support</dt>
                  <dd className="mt-1">
                    <a className="text-fg hover:text-accent" href={`mailto:${contact.support_email}`}>
                      {contact.support_email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {contact.contact_phone ? (
                <div>
                  <dt className="text-xs tracking-wide text-subtle uppercase">Phone</dt>
                  <dd className="mt-1">{contact.contact_phone}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="mt-6 text-sm text-muted">Use the form. Extra contact details show up here once they are configured.</p>
          )}
          <div className="mt-8">
            <LandingSupportNote />
          </div>
        </div>

        <form
          className="relative rounded-xl border border-border bg-surface p-5 shadow-card md:p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setOk(false);
            try {
              await submitPublicInquiry({ data: form });
              setOk(true);
              setForm({ name: "", company: "", email: "", phone: "", topic: "sales", message: "", website: "" });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not send the message");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                required
                name="name"
                autoComplete="name"
                placeholder="Your name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Company / ISP">
              <Input
                name="company"
                autoComplete="organization"
                placeholder="ISP name"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                required
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@isp.co.ke"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                name="phone"
                autoComplete="tel"
                placeholder="07xx"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3 grid gap-3">
            <Field label="Topic">
              <Select
                name="topic"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
              >
                {TOPICS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Message">
              <Textarea
                required
                name="message"
                minLength={10}
                rows={5}
                placeholder="How many customers, what access (PPPoE, hotspot, fibre), and what you want to understand."
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
            <div className="hidden" aria-hidden="true">
              <label>
                Website
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </label>
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          {ok ? <p className="mt-3 text-sm text-ok">Thanks. We have the message and will reply.</p> : null}
          <Button type="submit" className="mt-5" disabled={busy}>
            {busy ? "Sending…" : "Send message"}
          </Button>
        </form>
      </div>
    </section>
  );
}
