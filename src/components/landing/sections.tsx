import {
  ArrowDown,
  Bell,
  Boxes,
  Cable,
  Headset,
  MapPinned,
  Network,
  Radio,
  Receipt,
  Router,
  Share2,
  Smartphone,
  Ticket,
  Users,
  Wallet,
  Wifi,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

function SectionHead({
  id,
  eyebrow,
  title,
  body,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div id={id} className="max-w-2xl scroll-mt-24">
      <p className="text-xs font-medium tracking-[0.2em] text-accent uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted md:text-base">{body}</p>
    </div>
  );
}

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Receipt,
    title: "Billing that follows your services",
    body: "Recurring invoices, due dates, balances and statements stay tied to the package the customer actually has. When an account is overdue, access can be suspended; when payment lands, eligible services can come back on.",
  },
  {
    icon: Wallet,
    title: "M-Pesa and payments",
    body: "A payment should not end as a text on someone's phone. STK, paybill and till hits are matched to the invoice, posted on the account, and kept in the history you check when a customer queries a balance.",
  },
  {
    icon: Router,
    title: "MikroTik management",
    body: "Connect the routers you already run. Inventory and health go through a WireGuard agent, so you are not opening Winbox to the public internet just to check a site.",
  },
  {
    icon: Radio,
    title: "RADIUS and PPPoE",
    body: "Subscriber authentication and accounting through FreeRADIUS, with the username, package and session tied to the same customer you bill.",
  },
  {
    icon: Cable,
    title: "Customer equipment",
    body: "Where the plan includes it, GenieACS keeps supported CPE next to the service it belongs to — useful on fibre installs and replacements.",
  },
  {
    icon: Bell,
    title: "Customer communication",
    body: "Payment confirmations, invoice reminders, suspension and restoration notices, and new-connection updates — by SMS, WhatsApp or email, using the providers you configure.",
  },
  {
    icon: Users,
    title: "Customer management",
    body: "Keep details, services, packages, balances and history on one account. Your team can see what a customer is using and what needs attention without opening a second book.",
  },
  {
    icon: Network,
    title: "Tickets and field work",
    body: "Give support and field teams a place to record issues, follow up visits, and keep that history on the customer — next to router status and sessions.",
  },
  {
    icon: Wifi,
    title: "Hotspot and vouchers",
    body: "Hotspot customers, vouchers and sessions live beside PPPoE, so you are not running a separate billing process for walk-ins.",
  },
  {
    icon: MapPinned,
    title: "IP address management",
    body: "Pools, static assignments and the address on the service — so the team can see what is in use and what is still free.",
  },
  {
    icon: Share2,
    title: "Resellers",
    body: "When the plan includes the module, partners can manage their own customers and wallets without seeing the rest of your books.",
  },
  {
    icon: Boxes,
    title: "Reports and statements",
    body: "Collections, outstanding balances, active services, customer growth and billing activity in the console. Invoice and statement PDFs when someone wants paper.",
  },
];

export function LandingFeatures() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
      <SectionHead
        id="features"
        eyebrow="Features"
        title="The tools you need to run the day-to-day"
        body="From customer accounts and invoices to MikroTik and RADIUS, the important parts of the operation stay connected. What you see in the console follows the plan you are on."
      />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <article key={f.title} className="rounded-xl border border-border bg-surface p-5 shadow-card">
            <f.icon className="size-5 text-accent" />
            <h3 className="mt-4 text-base font-medium tracking-tight">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

const PAY_FLOW = ["Payment", "Verification", "Allocation", "Ledger", "Invoice", "Service renewal"];

export function LandingPayments() {
  return (
    <section id="payments" className="scroll-mt-24 border-y border-border bg-surface/60">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        <SectionHead
          eyebrow="Collections"
          title="Payments that make sense in your accounts"
          body="When a customer pays, your team needs to know who paid, what it was for, and whether the account is settled. A matched payment is allocated to the invoice, written on the ledger, and used to renew the service."
        />
        <ol className="mt-10 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          {PAY_FLOW.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="inline-flex h-11 items-center rounded-md border border-border bg-bg px-4 text-sm font-medium">
                {step}
              </span>
              {i < PAY_FLOW.length - 1 ? (
                <span className="hidden text-subtle md:inline" aria-hidden>
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <article className="rounded-xl border border-border bg-bg p-5">
            <p className="text-sm font-medium">M-Pesa and supported gateways</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Safaricom M-Pesa through Daraja — STK, paybill and till — and Kopo Kopo. You put in your own
              credentials for each ISP. Payment records, invoice allocation, balances and history stay on the
              account.
            </p>
          </article>
          <article className="rounded-xl border border-border bg-bg p-5">
            <p className="text-sm font-medium">What is not assumed</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Card acquiring is not built in. Other methods only appear if you enable them for that ISP. Bank
              details can still be printed on an invoice.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

export function LandingMessaging() {
  return (
    <section id="messaging" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:py-24">
      <SectionHead
        eyebrow="Customer messages"
        title="Keep customers informed"
        body="Customers want to know when an invoice is due, whether M-Pesa went through, and why the line is off. Send those messages without keeping a separate list for every channel."
      />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <ul className="grid gap-3 text-sm leading-relaxed text-muted">
          {[
            "Payment confirmations",
            "Invoice reminders",
            "Service suspension notices",
            "Service restoration messages",
            "New connection updates",
            "General customer communication",
          ].map((item) => (
            <li key={item} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <Smartphone className="size-4 text-accent" />
              {item}
            </li>
          ))}
        </ul>
        <article className="rounded-xl border border-border bg-surface p-5 md:p-6">
          <p className="text-sm font-medium">SMS, WhatsApp and email</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            SMS can go through Africa’s Talking, Talksasa, Webfam, Blessed Texts / Hostpinnacle, Twilio, or
            Advanta. WhatsApp uses Meta Cloud API. Email is sent when a mail provider is configured; otherwise it
            stays in the queue for that ISP.
          </p>
        </article>
      </div>
    </section>
  );
}

const SOLUTIONS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Wifi,
    title: "Wireless ISPs",
    body: "Customers, packages, billing and PPPoE on a MikroTik last mile — the usual WISP day, without a second system for the money.",
  },
  {
    icon: Cable,
    title: "Fibre ISPs",
    body: "Keep fibre customers, services, payments and CPE work together as the base grows — account and ONT in the same place.",
  },
  {
    icon: Ticket,
    title: "Hotspot operators",
    body: "Vouchers, customers, payments and access without a separate set of records for walk-ins.",
  },
  {
    icon: Users,
    title: "Growing ISPs",
    body: "Start with what you need today. Add routers, staff and modules as the plan allows. Existing accounts are not wiped when you change plan.",
  },
  {
    icon: Network,
    title: "Multi-site ISPs",
    body: "Several routers and locations under one ISP account, so the team shares one view of customers and services. A different company should use its own account.",
  },
  {
    icon: Share2,
    title: "Resellers",
    body: "Customers, services and wallets for partners, without handing over the rest of the business, when the reseller module is on the plan.",
  },
];

export function LandingSolutions() {
  return (
    <section className="border-y border-border bg-surface/60">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        <SectionHead
          id="solutions"
          eyebrow="Who it is for"
          title="Built around the way ISPs work"
          body="Different ISPs have different networks, but many of the daily jobs are the same: accounts, packages, money in, and who is allowed online."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <article key={s.title} className="rounded-xl border border-border bg-bg p-5">
              <s.icon className="size-5 text-accent" />
              <h3 className="mt-4 text-base font-medium">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Create your account",
    body: "Register with an email and password. That login becomes the owner for the ISP you name at signup.",
  },
  {
    n: "02",
    title: "Add customers and services",
    body: "Create the account, assign a package, and activate PPPoE, hotspot or a static service. You can import a customer CSV if you already have a list.",
  },
  {
    n: "03",
    title: "Connect what you already use",
    body: "Enrol MikroTik over the WireGuard agent, point RADIUS at your access, and put in M-Pesa or Kopo Kopo keys. You do not rebuild the last mile.",
  },
  {
    n: "04",
    title: "Run the daily work",
    body: "Invoices follow the service, payments update the account, and access can be suspended or restored from the same place.",
  },
];

export function LandingHow() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
      <SectionHead
        eyebrow="Getting started"
        title="Get started without changing everything at once"
        body="You do not need to rebuild the network to keep better books. Set up the account, add customers and services, connect the routers and payments you already use, and run the day from here."
      />
      <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-xl border border-border bg-surface p-5">
            <p className="font-mono text-xs text-accent">{s.n}</p>
            <h3 className="mt-3 text-base font-medium">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Flow({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 md:p-6">
      <p className="text-sm font-medium">{title}</p>
      <ol className="mt-5 flex flex-col items-start gap-2">
        {steps.map((step, i) => (
          <li key={step} className="flex flex-col items-start gap-2">
            <span className="inline-flex h-11 items-center rounded-md bg-bg px-4 text-sm shadow-card">{step}</span>
            {i < steps.length - 1 ? <ArrowDown className="ml-5 size-4 text-subtle" /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LandingArchitecture() {
  return (
    <section id="architecture" className="scroll-mt-24 border-y border-border bg-surface/60">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        <SectionHead
          eyebrow="How it fits"
          title="How it fits into your network"
          body="This software does not replace your routers, access points or last mile. The office side — customers, packages, billing and payments — sits here. MikroTik and FreeRADIUS handle who is allowed on. GenieACS, when you use it, talks to the CPE. If the office connection drops, the routers still forward the sessions they already have."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Flow
            title="In simple terms"
            steps={["Customer", "Service", "Billing", "Payment", "Network access", "Internet"]}
          />
          <Flow title="Customer equipment" steps={["Customer", "CPE", "GenieACS", "Access network"]} />
        </div>
      </div>
    </section>
  );
}

const FAQS: { q: string; a: string }[] = [
  {
    q: "What can I manage with ISP Solutions?",
    a: "Customer accounts, packages, billing, payments, network access, MikroTik routers, RADIUS, hotspot, CPE through GenieACS where the plan includes it, notifications, reports, tickets and the rest of the day-to-day.",
  },
  {
    q: "Can I connect my existing MikroTik network?",
    a: "Yes. Enrol the routers you already run over a WireGuard agent. You do not rebuild the last mile, and you do not need to publish Winbox or the API to the internet.",
  },
  {
    q: "Does it support PPPoE, hotspot and FreeRADIUS?",
    a: "Yes. PPPoE and hotspot sit on the same customer as the invoice. FreeRADIUS handles authentication and accounting. Hotspot users and vouchers are available on plans that include that module.",
  },
  {
    q: "Can payments update accounts and restore a suspended line?",
    a: "Yes. A matched M-Pesa or Kopo Kopo payment is posted to the invoice. Billing follows due dates and grace; overdue access can be suspended, and a qualifying payment can bring an eligible service back on.",
  },
  {
    q: "Can I send SMS, WhatsApp and email?",
    a: "Yes, on the channels you configure — typically payment confirmations, invoice reminders and service notices. SMS providers, Meta Cloud WhatsApp, and email when a mail provider is set.",
  },
  {
    q: "Can I import existing customers?",
    a: "Yes. There is a customer CSV import in the console, and you can export the list the same way.",
  },
  {
    q: "Is my customer information kept separate from other businesses?",
    a: "Yes. Each ISP works in its own workspace. Customer, invoice, router and payment records are not shared with other ISPs.",
  },
];

export function LandingFaq() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
      <SectionHead
        id="faq"
        eyebrow="Questions"
        title="What operators usually ask before they move"
        body="Answers describe what the software does today. Where something depends on your plan or on keys you supply, that is said plainly."
      />
      <div className="mt-10 grid gap-3">
        {FAQS.map((item) => (
          <details key={item.q} className="group rounded-xl border border-border bg-surface px-5 py-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
              {item.q}
              <span className="text-subtle group-open:hidden" aria-hidden>
                +
              </span>
              <span className="hidden text-subtle group-open:inline" aria-hidden>
                −
              </span>
            </summary>
            <p className="pb-4 text-sm leading-relaxed text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function LandingSupportNote() {
  return (
    <p className="flex items-start gap-2 text-sm text-muted">
      <Headset className="mt-0.5 size-4 shrink-0 text-accent" />
      Sales, getting started, and reseller questions use the same form. Pick a topic so the message lands in the
      right place.
    </p>
  );
}
