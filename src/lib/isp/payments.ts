import { nid } from "@/lib/utils";
import { restoreCustomerAccess, awardLoyalty } from "./access";
import { kopoIncomingPayment, kopoPaymentStatus, loadKopo } from "./kopokopo";
import { loadMpesa, mpesaStkPush, mpesaStkQuery } from "./mpesa";
import { notifyCustomerEvent } from "./notifications";
import { ensureOpsSchema } from "./ops-schema";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function applyConfirmedPayment(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    invoiceId: string;
    provider: string;
    reference: string;
  },
) {
  await ensureOpsSchema(sql);
  const [inv] = await sql<{
    id: string;
    customer_id: string;
    amount_kes: number;
    number: string;
    status: string;
  }>`select id, customer_id, amount_kes, number, status from invoices
     where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
  if (!inv) throw new Error("Invoice not found");
  const ref = opts.reference.trim();
  if (!ref) throw new Error("Payment reference is required");
  const dup = await sql<{ id: string }>`select id from payments where tenant_id = ${opts.tenantId} and reference = ${ref}`;
  if (dup[0]) throw new Error("Duplicate payment reference");
  const payId = nid("pay");
  await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${payId}, ${opts.tenantId}, ${inv.customer_id}, ${inv.id}, ${opts.provider || "mpesa"}, ${inv.amount_kes}, ${ref}, 'confirmed')`;
  await sql`update invoices set status = 'paid' where id = ${inv.id} and tenant_id = ${opts.tenantId}`;
  await restoreCustomerAccess(sql, opts.tenantId, inv.customer_id);
  await awardLoyalty(sql, opts.tenantId, inv.customer_id, inv.amount_kes);
  await notifyCustomerEvent(sql, opts.tenantId, opts.ispName, inv.customer_id, "payment.received", payId, {
    customer_name: "",
    invoice_number: inv.number,
    amount: `KES ${inv.amount_kes}`,
    payment_reference: ref,
  });
  await notifyCustomerEvent(sql, opts.tenantId, opts.ispName, inv.customer_id, "service.restored", `${payId}-restore`, {
    customer_name: "",
    payment_reference: ref,
    service_name: "Internet",
  });
  return { id: payId, amount: inv.amount_kes };
}

export async function createStkIntent(
  sql: Sql,
  opts: { tenantId: string; invoiceId: string; provider: string },
) {
  await ensureOpsSchema(sql);
  const [inv] = await sql<{ id: string; customer_id: string; amount_kes: number; status: string }>`
    select id, customer_id, amount_kes, status from invoices where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "paid") throw new Error("Invoice already paid");
  const [prov] = await sql<{ enabled: boolean }>`
    select enabled from payment_providers where tenant_id = ${opts.tenantId} and kind = ${opts.provider}`;
  if (prov && !prov.enabled) throw new Error("Provider disabled");
  const [cus] = await sql<{ phone: string; name: string; email: string }>`
    select phone, name, email from customers where id = ${inv.customer_id}`;
  const [ten] = await sql<{ slug: string; public_base_url: string }>`
    select slug, public_base_url from tenants where id = ${opts.tenantId}`;
  const origin = (ten?.public_base_url || "").replace(/\/$/, "");
  const mpesaCb = origin && ten?.slug ? `${origin}/api/webhooks/mpesa/${ten.slug}` : "";
  const kopoCb = origin && ten?.slug ? `${origin}/api/webhooks/kopokopo/${ten.slug}` : "";
  let checkout = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let note = "queued";

  if (opts.provider === "kopokopo") {
    const cfg = await loadKopo(sql, opts.tenantId);
    if (!cfg || !cfg.enabled) throw new Error("Kopo Kopo is disabled");
    if (!cfg.sandbox && !kopoCb) {
      throw new Error("Set the public site URL in Settings — Kopo Kopo needs a callback URL");
    }
    if (cfg.client_id && cfg.client_secret) {
      try {
        const [invFull] = await sql<{ number: string }>`select number from invoices where id = ${inv.id}`;
        const parts = (cus?.name || "Customer").trim().split(/\s+/);
        const pushed = await kopoIncomingPayment(cfg, {
          phone: cus?.phone ?? "",
          amount: inv.amount_kes,
          firstName: parts[0] || "Customer",
          lastName: parts.slice(1).join(" ") || "Pay",
          email: cus?.email,
          invoiceId: inv.id,
          invoiceNumber: invFull?.number || inv.id,
          callbackUrl: kopoCb || undefined,
        });
        checkout = pushed.id || pushed.location || checkout;
        note = cfg.sandbox ? "kopokopo sandbox STK sent" : "kopokopo STK sent";
      } catch (e) {
        if (!cfg.sandbox) throw e;
        note = e instanceof Error ? `sandbox fallback: ${e.message}` : "sandbox fallback";
      }
    } else {
      note = "kopokopo sandbox (no keys) — simulated STK";
    }
  }

  if (opts.provider === "mpesa") {
    const cfg = await loadMpesa(sql, opts.tenantId);
    if (cfg && !cfg.enabled) throw new Error("M-Pesa is disabled");
    if (cfg && !cfg.sandbox && !mpesaCb) {
      throw new Error("Set the public site URL in Settings — Daraja needs a callback URL");
    }
    if (cfg?.client_id && cfg.client_secret && cfg.passkey) {
      try {
        const [invFull] = await sql<{ number: string }>`select number from invoices where id = ${inv.id}`;
        const pushed = await mpesaStkPush(cfg, {
          phone: cus?.phone ?? "",
          amount: inv.amount_kes,
          account: invFull?.number || "BILL",
          description: "Internet bill",
          callbackUrl: mpesaCb || undefined,
        });
        checkout = pushed.checkout_id;
        note = pushed.message;
      } catch (e) {
        if (!cfg.sandbox) throw e;
        note = e instanceof Error ? `sandbox fallback: ${e.message}` : "sandbox fallback";
      }
    } else {
      note = "M-Pesa sandbox (no keys) — simulated STK";
    }
  }

  const id = nid("int");
  await sql`insert into payment_intents (id, tenant_id, invoice_id, customer_id, provider, amount_kes, phone, checkout_id, status)
    values (${id}, ${opts.tenantId}, ${inv.id}, ${inv.customer_id}, ${opts.provider}, ${inv.amount_kes}, ${cus?.phone ?? ""}, ${checkout}, 'pending')`;
  return { id, checkout_id: checkout, phone: cus?.phone ?? "", amount_kes: inv.amount_kes, note };
}

export async function settleStkIntent(
  sql: Sql,
  opts: { tenantId: string; ispName: string; checkoutId: string },
) {
  const [intent] = await sql<{
    id: string;
    invoice_id: string;
    provider: string;
    status: string;
    checkout_id: string;
  }>`select id, invoice_id, provider, status, checkout_id from payment_intents
     where checkout_id = ${opts.checkoutId} and tenant_id = ${opts.tenantId}`;
  if (!intent) throw new Error("STK request not found");
  if (intent.status === "confirmed") throw new Error("Already confirmed");

  let reference = intent.checkout_id;
  if (intent.provider === "kopokopo") {
    const cfg = await loadKopo(sql, opts.tenantId);
    if (cfg?.client_id && cfg.client_secret) {
      const st = await kopoPaymentStatus(cfg, intent.checkout_id);
      if (st.status && st.status !== "Success" && st.status !== "Received") {
        throw new Error(`Kopo Kopo status: ${st.status}`);
      }
      if (st.reference) reference = st.reference;
    }
  }

  if (intent.provider === "mpesa") {
    const cfg = await loadMpesa(sql, opts.tenantId);
    if (cfg?.client_id && cfg.client_secret && cfg.passkey && !intent.checkout_id.startsWith("ws_")) {
      const q = await mpesaStkQuery(cfg, intent.checkout_id);
      if (!q.ok) throw new Error(q.resultDesc || `M-Pesa ResultCode ${q.resultCode}`);
    }
  }

  const pay = await applyConfirmedPayment(sql, {
    tenantId: opts.tenantId,
    ispName: opts.ispName,
    invoiceId: intent.invoice_id,
    provider: intent.provider,
    reference,
  });
  await sql`update payment_intents set status = 'confirmed' where id = ${intent.id}`;
  return pay;
}
