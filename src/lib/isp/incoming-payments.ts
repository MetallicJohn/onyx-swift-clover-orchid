import { nid } from "../utils.ts";
import { remainingKes, statusAfterPayment } from "./billing.ts";
import { resolveAccountNumber } from "./document-format.ts";
import { emit } from "./events.ts";
import { allocatePayment, recordLedger } from "./ledger.ts";
import { normalizePhone } from "./phone.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type IncomingHit = {
  provider: string;
  channel: string;
  transId: string;
  billRef: string;
  msisdn: string;
  payerName: string;
  amountKes: number;
  shortcode: string;
  transTime: string;
  payload: unknown;
};

export function isC2bBody(body: Record<string, unknown>) {
  if (!body || typeof body !== "object") return false;
  if ((body.Body as Record<string, unknown> | undefined)?.stkCallback) return false;
  const transId = String(body.TransID || body.TransId || body.transactionId || "");
  const amount = body.TransAmount ?? body.transAmount ?? body.Amount;
  return Boolean(transId && amount != null);
}

export function parseMpesaTransTime(raw: string) {
  const s = String(raw || "").replace(/\D/g, "");
  if (s.length < 14) return new Date().toISOString();
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+03:00`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

export function parseC2bBody(body: Record<string, unknown>): IncomingHit | null {
  const transId = String(body.TransID || body.TransId || body.transactionId || "").trim();
  const amount = Math.round(Number(body.TransAmount ?? body.transAmount ?? body.Amount ?? 0));
  if (!transId || !Number.isFinite(amount) || amount <= 0) return null;
  const type = String(body.TransactionType || body.transactionType || "").toLowerCase();
  let channel = "paybill";
  if (/buy goods|c2b|till|lipa/.test(type) && !/pay\s*bill/.test(type)) channel = "till";
  if (/stk|lipa na m-pesa online/.test(type)) channel = "stk";
  return {
    provider: "mpesa",
    channel,
    transId,
    billRef: String(body.BillRefNumber || body.BillRefNo || body.accountReference || "").trim(),
    msisdn: String(body.MSISDN || body.msisdn || body.PhoneNumber || ""),
    payerName: [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).map(String).join(" ").trim(),
    amountKes: amount,
    shortcode: String(body.BusinessShortCode || body.ShortCode || body.TillNumber || ""),
    transTime: parseMpesaTransTime(String(body.TransTime || "")),
    payload: body,
  };
}

export function parseStkAsIncoming(parsed: {
  checkout: string;
  receipt: string;
  amount?: number;
  phone?: string;
}): IncomingHit | null {
  const transId = (parsed.receipt || parsed.checkout || "").trim();
  const amount = Math.round(Number(parsed.amount || 0));
  if (!transId || !amount) return null;
  return {
    provider: "mpesa",
    channel: "stk",
    transId,
    billRef: parsed.checkout || "",
    msisdn: parsed.phone || "",
    payerName: "",
    amountKes: amount,
    shortcode: "",
    transTime: new Date().toISOString(),
    payload: parsed,
  };
}

function digits(value: string) {
  return (value || "").replace(/\D/g, "");
}

function refKey(value: string) {
  return (value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export async function matchIncomingCustomer(
  sql: Sql,
  tenantId: string,
  hit: Pick<IncomingHit, "billRef" | "msisdn">,
) {
  const customers = await sql<{ id: string; name: string; phone: string; account_number: string }>`
    select id, name, phone, coalesce(account_number,'') as account_number from customers where tenant_id = ${tenantId}`;
  const [tenant] = await sql<{ slug: string }>`select slug from tenants where id = ${tenantId}`;
  const slug = tenant?.slug || "";
  const bill = refKey(hit.billRef);
  const phone = normalizePhone(hit.msisdn);
  const phone9 = digits(phone).slice(-9);
  const hits: string[] = [];
  if (bill) {
    for (const c of customers) {
      const acc = refKey(resolveAccountNumber(slug, c.id, c.account_number));
      if (acc && (acc === bill || acc.replace(/-/g, "") === bill)) hits.push(c.id);
    }
    const invoices = await sql<{ id: string; customer_id: string; number: string }>`
      select id, customer_id, number from invoices where tenant_id = ${tenantId}`;
    for (const inv of invoices) {
      if (refKey(inv.number) === bill) hits.push(inv.customer_id);
    }
    const services = await sql<{ customer_id: string; username: string }>`
      select customer_id, coalesce(username,'') as username from services where tenant_id = ${tenantId}`;
    for (const s of services) {
      if (s.username && refKey(s.username) === bill) hits.push(s.customer_id);
    }
  }
  if (phone9.length === 9) {
    for (const c of customers) {
      if (digits(normalizePhone(c.phone)).slice(-9) === phone9) hits.push(c.id);
    }
  }
  const unique = [...new Set(hits)];
  if (unique.length === 1) {
    const reason = bill ? `bill_ref:${hit.billRef}` : `msisdn:${phone}`;
    return { customerId: unique[0], reason };
  }
  if (unique.length > 1) return { customerId: "", reason: "ambiguous" };
  return { customerId: "", reason: "" };
}

export async function creditCustomerPayment(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    customerId: string;
    reference: string;
    amountKes: number;
    provider: string;
    invoiceId?: string;
  },
) {
  const ref = opts.reference.trim();
  if (!ref) throw new Error("Payment reference is required");
  const amount = Math.max(1, Math.round(opts.amountKes));
  const dup = await sql<{ id: string }>`select id from payments where tenant_id = ${opts.tenantId} and reference = ${ref}`;
  if (dup[0]) return { id: dup[0].id, amount, status: "confirmed" as const, duplicate: true };
  const [cus] = await sql<{ id: string }>`
    select id from customers where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  if (!cus) throw new Error("Customer not found");
  let invoices = await sql<{ id: string; amount_kes: number; paid_kes: number; status: string; number: string }>`
    select id, amount_kes, paid_kes, status, number from invoices
    where tenant_id = ${opts.tenantId} and customer_id = ${opts.customerId}
      and status in ('issued','due','overdue','partial','sent','pending')
    order by due_date, issued_at`;
  if (opts.invoiceId) {
    invoices = invoices.filter((i) => i.id === opts.invoiceId);
    if (invoices.length === 0) {
      const [one] = await sql<{ id: string; amount_kes: number; paid_kes: number; status: string; number: string }>`
        select id, amount_kes, paid_kes, status, number from invoices
        where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId} and customer_id = ${opts.customerId}`;
      if (one) invoices = [one];
    }
  }
  const payId = nid("pay");
  const firstInvoice = invoices[0]?.id ?? null;
  await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${payId}, ${opts.tenantId}, ${opts.customerId}, ${opts.invoiceId || firstInvoice}, ${opts.provider}, ${amount}, ${ref}, 'confirmed')`;
  await recordLedger(sql, {
    tenantId: opts.tenantId,
    customerId: opts.customerId,
    entryType: "payment",
    creditKes: amount,
    refType: "payment",
    refId: payId,
    memo: `${opts.provider} ${ref}`,
  });
  let left = amount;
  for (const inv of invoices) {
    if (left <= 0) break;
    const due = remainingKes(inv.amount_kes, inv.paid_kes, inv.status);
    if (due <= 0) continue;
    const take = Math.min(left, due);
    const paid = inv.paid_kes + take;
    const status = statusAfterPayment(inv.amount_kes, paid, inv.status);
    await sql`update invoices set status = ${status}, paid_kes = ${paid} where id = ${inv.id} and tenant_id = ${opts.tenantId}`;
    await allocatePayment(sql, { tenantId: opts.tenantId, paymentId: payId, invoiceId: inv.id, amountKes: take });
    left -= take;
  }
  await emit(sql, {
    type: "payment.confirmed",
    tenantId: opts.tenantId,
    payload: {
      payment_id: payId,
      customer_id: opts.customerId,
      invoice_id: opts.invoiceId || firstInvoice || "",
      amount_kes: amount,
      reference: ref,
      provider: opts.provider,
      isp_name: opts.ispName,
    },
  });
  return { id: payId, amount, status: "confirmed" as const, duplicate: false };
}

export async function ingestIncomingPayment(
  sql: Sql,
  tenant: { id: string; name: string },
  hit: IncomingHit,
  opts: { autoMatch?: boolean } = {},
) {
  const [existing] = await sql<{ id: string; status: string }>`
    select id, status from incoming_payments where tenant_id = ${tenant.id} and trans_id = ${hit.transId}`;
  if (existing) return { id: existing.id, status: existing.status, created: false };
  const id = nid("inp");
  await sql`insert into incoming_payments
    (id, tenant_id, provider, channel, trans_id, bill_ref, msisdn, payer_name, amount_kes, shortcode, trans_time, status, payload)
    values (${id}, ${tenant.id}, ${hit.provider}, ${hit.channel}, ${hit.transId}, ${hit.billRef}, ${hit.msisdn},
      ${hit.payerName}, ${hit.amountKes}, ${hit.shortcode}, ${hit.transTime}::timestamptz, 'unmatched',
      ${JSON.stringify(hit.payload).slice(0, 8000)})`;
  if (opts.autoMatch === false) return { id, status: "unmatched" as const, created: true };
  const match = await matchIncomingCustomer(sql, tenant.id, hit);
  if (!match.customerId) {
    await sql`update incoming_payments set match_reason = ${match.reason} where id = ${id}`;
    return { id, status: "unmatched" as const, created: true };
  }
  try {
    const pay = await creditCustomerPayment(sql, {
      tenantId: tenant.id,
      ispName: tenant.name,
      customerId: match.customerId,
      reference: hit.transId,
      amountKes: hit.amountKes,
      provider: hit.provider,
    });
    await sql`update incoming_payments set status = 'matched', customer_id = ${match.customerId},
      payment_id = ${pay.id}, match_reason = ${match.reason} where id = ${id}`;
    return { id, status: "matched" as const, created: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await sql`update incoming_payments set match_reason = ${reason} where id = ${id}`;
    return { id, status: "unmatched" as const, created: true };
  }
}

export async function assignIncomingPayments(
  sql: Sql,
  opts: {
    tenantId: string;
    ispName: string;
    userId: string;
    ids: string[];
    customerId: string;
    invoiceId?: string;
  },
) {
  if (!opts.ids.length) throw new Error("Select at least one payment");
  if (!opts.customerId) throw new Error("Pick the customer account");
  const assigned = [];
  for (const id of opts.ids) {
    const [row] = await sql<{
      id: string;
      trans_id: string;
      amount_kes: number;
      provider: string;
      status: string;
    }>`select id, trans_id, amount_kes, provider, status from incoming_payments
       where id = ${id} and tenant_id = ${opts.tenantId}`;
    if (!row) throw new Error("Incoming payment not found");
    if (row.status !== "unmatched") continue;
    const pay = await creditCustomerPayment(sql, {
      tenantId: opts.tenantId,
      ispName: opts.ispName,
      customerId: opts.customerId,
      reference: row.trans_id,
      amountKes: row.amount_kes,
      provider: row.provider,
      invoiceId: opts.invoiceId,
    });
    await sql`update incoming_payments set status = 'assigned', customer_id = ${opts.customerId},
      invoice_id = ${opts.invoiceId || null}, payment_id = ${pay.id}, match_reason = 'manual',
      assigned_by = ${opts.userId}, assigned_at = now() where id = ${row.id}`;
    assigned.push(row.id);
  }
  return { assigned: assigned.length };
}

export async function listIncomingPayments(sql: Sql, tenantId: string) {
  const [tenant] = await sql<{ slug: string }>`select slug from tenants where id = ${tenantId}`;
  const slug = tenant?.slug || "";
  const rows = await sql<{
    id: string;
    channel: string;
    trans_id: string;
    bill_ref: string;
    msisdn: string;
    payer_name: string;
    amount_kes: number;
    shortcode: string;
    trans_time: string;
    status: string;
    match_reason: string;
    customer_id: string | null;
    customer_name: string | null;
    invoice_id: string | null;
  }>`select p.id, p.channel, p.trans_id, p.bill_ref, p.msisdn, p.payer_name, p.amount_kes, p.shortcode,
            p.trans_time::text as trans_time, p.status, p.match_reason, p.customer_id, c.name as customer_name,
            p.invoice_id
     from incoming_payments p
     left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
     where p.tenant_id = ${tenantId}
     order by p.trans_time desc
     limit 300`;
  const customers = await sql<{ id: string; name: string; phone: string; account_number: string }>`
    select id, name, phone, coalesce(account_number,'') as account_number from customers where tenant_id = ${tenantId} order by name limit 400`;
  const invoices = await sql<{
    id: string;
    number: string;
    customer_id: string;
    amount_kes: number;
    paid_kes: number;
    status: string;
  }>`select id, number, customer_id, amount_kes, paid_kes, status from invoices
     where tenant_id = ${tenantId} and status in ('issued','due','overdue','partial','sent','pending')
     order by due_date`;
  const unmatched = rows.filter((r) => r.status === "unmatched").length;
  const totalKes = rows.reduce((s, r) => s + r.amount_kes, 0);
  return {
    rows,
    unmatched,
    totalKes,
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      account: resolveAccountNumber(slug, c.id, c.account_number),
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      customer_id: i.customer_id,
      remaining: remainingKes(i.amount_kes, i.paid_kes, i.status),
      status: i.status,
    })),
  };
}
