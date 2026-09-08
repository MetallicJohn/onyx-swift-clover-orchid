import { getSql } from "@/lib/db";
import { nid } from "@/lib/utils";
import { evaluateStkCallback, parseKopokopoCallback, parseMpesaCallback } from "./callback-validate";
import { applyConfirmedPayment } from "./payments";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export function callbackUrls(base: string, slug: string) {
  const root = (base || "").replace(/\/$/, "");
  if (!root || !slug) return { mpesa: "", kopokopo: "" };
  return {
    mpesa: `${root}/api/webhooks/mpesa/${encodeURIComponent(slug)}`,
    kopokopo: `${root}/api/webhooks/kopokopo/${encodeURIComponent(slug)}`,
  };
}

async function tenantBySlug(sql: Sql, slug: string) {
  const [t] = await sql<{ id: string; name: string; slug: string }>`
    select id, name, slug from tenants where slug = ${slug}`;
  return t ?? null;
}

async function logWebhook(
  sql: Sql,
  tenantId: string,
  provider: string,
  checkoutId: string,
  payload: unknown,
  status: string,
) {
  await sql`insert into payment_webhooks (id, tenant_id, provider, checkout_id, payload, status)
    values (${nid("wh")}, ${tenantId}, ${provider}, ${checkoutId}, ${JSON.stringify(payload).slice(0, 8000)}, ${status})`;
}

async function loadIntent(sql: Sql, tenantId: string, checkout: string) {
  const [intent] = await sql<{
    id: string;
    invoice_id: string;
    status: string;
    checkout_id: string;
    amount_kes: number;
  }>`select id, invoice_id, status, checkout_id, amount_kes from payment_intents
     where tenant_id = ${tenantId} and checkout_id = ${checkout}`;
  return intent ?? null;
}

async function settleFromDecision(
  sql: Sql,
  tenant: { id: string; name: string },
  provider: string,
  intent: { id: string; invoice_id: string; status: string; checkout_id: string; amount_kes: number },
  parsed: { checkout: string; resultCode: number; resultDesc: string; receipt: string; amount?: number },
) {
  const decision = evaluateStkCallback(intent, parsed);
  if (decision.action === "idempotent") return "idempotent";
  if (decision.action === "ignore") return decision.reason;
  if (decision.action === "fail") {
    await sql`update payment_intents set status = ${decision.intentStatus}, fail_reason = ${decision.reason}
      where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
    return decision.intentStatus;
  }
  if (decision.action === "reconcile") {
    await sql`update payment_intents set status = 'reconciliation_required', fail_reason = ${decision.reason}
      where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
    return "reconciliation_required";
  }
  try {
    await applyConfirmedPayment(sql, {
      tenantId: tenant.id,
      ispName: tenant.name,
      invoiceId: intent.invoice_id,
      provider,
      reference: decision.reference,
    });
    await sql`update payment_intents set status = 'confirmed', fail_reason = ''
      where id = ${intent.id} and tenant_id = ${tenant.id}`;
    return "confirmed";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "confirm failed";
    if (/Duplicate/i.test(msg)) {
      await sql`update payment_intents set status = 'confirmed' where id = ${intent.id}`;
      return "idempotent";
    }
    throw e;
  }
}

export async function handleMpesaCallback(slug: string, body: Record<string, unknown>) {
  const sql = await getSql();
  const tenant = await tenantBySlug(sql, slug);
  const parsed = parseMpesaCallback(body);
  if (!tenant) return { ResultCode: 0, ResultDesc: "Unknown tenant" };
  await logWebhook(sql, tenant.id, "mpesa", parsed.checkout, body, String(parsed.resultCode));
  if (!parsed.checkout) return { ResultCode: 0, ResultDesc: "Accepted" };
  const intent = await loadIntent(sql, tenant.id, parsed.checkout);
  if (!intent) return { ResultCode: 0, ResultDesc: "Unknown checkout" };
  const result = await settleFromDecision(sql, tenant, "mpesa", intent, parsed);
  return { ResultCode: 0, ResultDesc: result };
}

export async function handleKopokopoCallback(slug: string, body: Record<string, unknown>) {
  const sql = await getSql();
  const tenant = await tenantBySlug(sql, slug);
  if (!tenant) return { ok: false };
  const parsed = parseKopokopoCallback(body);
  await logWebhook(sql, tenant.id, "kopokopo", parsed.checkout, body, parsed.resultDesc || "received");
  if (!parsed.checkout) return { ok: true };
  const intent =
    (await loadIntent(sql, tenant.id, parsed.checkout)) ||
    (
      await sql<{
        id: string;
        invoice_id: string;
        status: string;
        checkout_id: string;
        amount_kes: number;
      }>`select id, invoice_id, status, checkout_id, amount_kes from payment_intents
         where tenant_id = ${tenant.id} and checkout_id like ${"%" + parsed.checkout} limit 1`
    )[0];
  if (!intent) return { ok: true };
  const aligned = { ...parsed, checkout: intent.checkout_id };
  await settleFromDecision(sql, tenant, "kopokopo", intent, aligned);
  return { ok: true };
}

export async function tenantPayUrls(sql: Sql, tenantId: string, originFallback = "") {
  const [t] = await sql<{ slug: string; public_base_url: string }>`
    select slug, public_base_url from tenants where id = ${tenantId}`;
  const base = (t?.public_base_url || originFallback).replace(/\/$/, "");
  return {
    slug: t?.slug ?? "",
    public_base_url: t?.public_base_url ?? "",
    ...callbackUrls(base, t?.slug ?? ""),
  };
}
