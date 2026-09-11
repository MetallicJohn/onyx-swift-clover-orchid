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
    title: "Billing and invoices",
    body: "Recurring invoices, due dates, grace, and statements on one ledger. When an account expires, access can be suspended; when payment lands, the service can come back on.",
  },
  {
    icon: Wallet,
    title: "M-Pesa and collections",
    body: "STK, paybill, and till payments are matched to the invoice, posted on the account, and kept in the history you check when a customer queries a balance.",
  },
  {
    icon: Router,
    title: "MikroTik routers",
    body: "Inventory and health through a WireGuard agent, so you are not opening Winbox to the public internet just to check a site.",
  },
  {
    icon: Radio,
    title: "RADIUS and PPPoE",
    body: "Username, package, and session state stay tied to the customer. Authentication and accounting run against the same record you bill.",
  },
  {
    icon: Cable,
    title: "Customer equipment",
    body: "Where the plan includes it, compatible CPE is managed next to the account through GenieACS — useful on fibre installs and replacements.",
  },
  {
    icon: Bell,
    title: "SMS, WhatsApp, and email",
    body: "Confirm a payment, remind a due date, or tell a customer the line is suspended or restored. You choose the SMS house and WhatsApp account.",
  },
  {
    icon: Users,
    title: "Customer accounts",
    body: "Open an account, attach a package, and activate the service. The same record then carries invoices, payments, tickets, and whether the line is online.",
  },
  {
    icon: Network,
    title: "Network operations",
    body: "Router status, sessions, and field tickets for the people who actually climb the mast or visit the cabinet.",
  },
  {
    icon: Wifi,
    title: "Hotspot and vouchers",
    body: "Walk-in users and voucher batches live beside PPPoE customers, so a hotspot site is not a second product.",
  },
  {
    icon: MapPinned,
    title: "IP addresses",
    body: "Pools, static assignments, and the address on the service — the same place you already keep the customer.",
  },
  {
    icon: Share2,
    title: "Resellers and partners",
    body: "When the plan includes the module, partners can manage their own customers and wallets without seeing the rest of your books.",
  },
  {
    icon: Boxes,
    title: "Reports and statements",
    body: "Collections, outstanding balances, active services, and billing activity in the console. Invoice and statement PDFs when a customer wants paper.",
  },
];

export function LandingFeatures() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
      <SectionHead
        id="features"
        eyebrow="What you can run"
        title="The work an ISP already does, in one console"
        body="Which modules you see depends on the plan you are on. Nothing here is a separate product you have to stitch together later."
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
          title="M-Pesa hits the account, not a spreadsheet"
          body="A payment is checked, allocated to the invoice, written on the ledger, and used to renew the service. That is the same loop your cashier already does — without chasing a paybill SMS."
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
            <p className="text-sm font-medium">What is wired today</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Safaricom M-Pesa through Daraja — STK, paybill, and till — and Kopo Kopo. You put in your own
              credentials for each ISP.
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
        title="Tell the customer what happened to the line"
        body="Most of these messages already exist in the billing cycle. You pick SMS, WhatsApp, or email, and which provider sends them."
      />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <ul className="grid gap-3 text-sm leading-relaxed text-muted">
          {[
            "Payment received",
            "Invoice due or overdue",
            "Service suspended",
            "Service restored after payment",
            "New connection is live",
            "General notices to a customer",
          ].map((item) => (
            <li key={item} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <Smartphone className="size-4 text-accent" />
              {item}
            </li>
          ))}
        </ul>
        <article className="rounded-xl border border-border bg-surface p-5 md:p-6">
          <p className="text-sm font-medium">How messages go out</p>
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
    body: "Packages, PPPoE usernames, and M-Pesa on a MikroTik last mile — the usual WISP day, without a second system for the money.",
  },
  {
    icon: Cable,
    title: "Fibre ISPs",
    body: "Activations, static IPs, invoices, and CPE work for FTTx crews who need the account and the ONT in the same place.",
  },
  {
    icon: Ticket,
    title: "Hotspot operators",
    body: "Vouchers, sessions, and walk-in payments next to any PPPoE customers you also run. Not a standalone hotspot box.",
  },
  {
    icon: Users,
    title: "Small and growing ISPs",
    body: "Start with a handful of customers and add routers, staff, and modules as the plan allows. Existing accounts are not wiped when you change plan.",
  },
  {
    icon: Network,
    title: "Several sites, one ISP",
    body: "Multiple routers and POPs sit under one ISP account. A different company should use its own account so the books stay apart.",
  },
  {
    icon: Share2,
    title: "Resellers and partners",
    body: "Give a partner their customers and wallet without handing over your whole network, when the reseller module is on the plan.",
  },
];

export function LandingSolutions() {
  return (
    <section className="border-y border-border bg-surface/60">
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        <SectionHead
          id="solutions"
          eyebrow="Who it is for"
          title="The same console, used the way each ISP actually works"
          body="Wireless, fibre, hotspot, and reseller businesses all bill customers and keep them online. The difference is the access method and how money comes in."
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
    title: "Set up the ISP",
    body: "Add packages, staff, and the company details that appear on invoices. Branding, if you want it, is set here.",
  },
  {
    n: "03",
    title: "Add customers and services",
    body: "Create accounts, pick a package, and activate PPPoE, hotspot, or a static service. You can also import a customer CSV.",
  },
  {
    n: "04",
    title: "Connect routers and M-Pesa",
    body: "Enrol MikroTik over the WireGuard agent, point RADIUS at your access, and put in Daraja or Kopo Kopo keys. Daily work then happens in the console.",
  },
];

export function LandingHow() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
      <SectionHead
        eyebrow="Getting started"
        title="From signup to the first online customer"
        body="You keep the radios, fibre, and routers you already have. This is the operations layer you log into after that."
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
          eyebrow="How it sits on the network"
          title="It does not replace your radios or fibre"
          body="The console sits between the office and the access network. Customers, invoices, and M-Pesa live here. RADIUS and the MikroTik agent tell the network who is allowed on. GenieACS, when you use it, talks to the CPE. If the office system is unreachable, the routers still forward traffic they already have."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Flow
            title="Account to the internet"
            steps={["Customer", "Invoice", "M-Pesa", "RADIUS", "MikroTik", "Internet"]}
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
    a: "Customer accounts, packages, invoices, M-Pesa and Kopo Kopo payments, PPPoE and hotspot access, MikroTik routers, RADIUS sessions, tickets, notifications, and reports. CPE through GenieACS is available on plans that include it.",
  },
  {
    q: "Can I connect my MikroTik routers?",
    a: "Yes. Routers enrol through a WireGuard agent. You do not need to publish Winbox or the API to the internet to manage them from the console.",
  },
  {
    q: "Does it support PPPoE?",
    a: "Yes. PPPoE is a normal access method: username, package, session, and the invoice sit on the same customer.",
  },
  {
    q: "Can I use FreeRADIUS?",
    a: "RADIUS is part of the system for authenticating and accounting PPPoE (and related) sessions against the subscriber record. You are not expected to run a separate billing RADIUS beside it.",
  },
  {
    q: "Can payments automatically update customer accounts?",
    a: "Yes. A matched M-Pesa or Kopo Kopo payment is allocated to the invoice, posted on the ledger, and can restore a service that was waiting on that money.",
  },
  {
    q: "Can the system suspend customers when their accounts expire?",
    a: "Yes. Billing follows due dates and grace. When the account is past that window, access can be suspended so the line does not stay open on goodwill.",
  },
  {
    q: "Can customers be restored after payment?",
    a: "Yes. Once the payment is confirmed against the invoice, the service can be brought back without a manual queue on the router.",
  },
  {
    q: "Can I manage Hotspot users and vouchers?",
    a: "Yes, on plans that include hotspot. Users, vouchers, and sessions are in the same ISP account as any PPPoE customers.",
  },
  {
    q: "Can I manage customer routers or CPE devices?",
    a: "Compatible CPE can be managed through GenieACS when that module is on your plan. It sits next to the customer, not in a separate login.",
  },
  {
    q: "Does it work with GenieACS?",
    a: "Yes, as a plan entitlement. Device workflows stay beside billing rather than in another silo.",
  },
  {
    q: "Can I send SMS, WhatsApp and email notifications?",
    a: "Yes. SMS providers are configurable. WhatsApp uses Meta Cloud API. Email goes out when a mail provider is configured; otherwise messages stay queued for that ISP.",
  },
  {
    q: "Can I manage more than one network location?",
    a: "Yes. One ISP account can hold many routers and sites. A second company should have its own account so customers and money do not mix.",
  },
  {
    q: "Can my staff have different permissions?",
    a: "Yes. Owner and staff logins are separate, and staff seats follow the plan limit. People only see what their role allows in that ISP.",
  },
  {
    q: "Can I import existing customers?",
    a: "Yes. There is a customer CSV import in the console, and you can export the list the same way.",
  },
  {
    q: "What happens if my internet connection to the management system is temporarily unavailable?",
    a: "Routers keep forwarding sessions they already have. You will not see new M-Pesa, change accounts, or push provisioning until the console and agent can reach each other again.",
  },
  {
    q: "Can I use my own branding?",
    a: "Yes. Each ISP can set colours, fonts, logo, and favicon for the console, login, and customer-facing pages. This public website always uses ISP Solutions branding.",
  },
  {
    q: "Can I connect my existing MikroTik network without rebuilding it?",
    a: "Yes. Enrol the routers you already run. Packages and customers are created in the console; you are not asked to replace the last mile.",
  },
  {
    q: "Is my customer data separated from other businesses using the software?",
    a: "Yes. Each ISP works in its own workspace. Customer, invoice, router, and payment records are not shared with other ISPs. Superadmin sees ISP metadata, not your customer list.",
  },
  {
    q: "How are payments and invoices recorded?",
    a: "Invoices live on the customer ledger with amounts, due dates, and status. Payments are stored with provider, reference, and allocation. Unmatched paybill or till hits can be assigned by hand.",
  },
  {
    q: "Can I see customer statements and outstanding balances?",
    a: "Yes. Statements and invoice PDFs can be generated from the console. Ageing and outstanding balances are in reports, and the customer portal shows the account to the subscriber.",
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
