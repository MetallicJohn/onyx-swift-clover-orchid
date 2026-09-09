import { nid } from "../utils.ts";
import { evaluateStkCallback, parseKopokopoCallback, parseMpesaCallback } from "./callback-validate";
import { ingestIncomingPayment, isC2bBody, parseC2bBody, parseStkAsIncoming } from "./incoming-payments";
import { applyConfirmedPayment } from "./payments";
import { applyRls } from "./rls";
import { applySaasPayment } from "./saas";

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
  await applyRls(sql, { bypass: true });
  const [t] = await sql<{ id: string; name: string; slug: string }>`
    select id, name, slug from tenants where slug = ${slug}`;
  if (t) await applyRls(sql, { tenantId: t.id, bypass: false });
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

type LoadedIntent = {
  id: string;
  invoice_id: string;
  status: string;
  checkout_id: string;
  amount_kes: number;
  kind: "customer" | "saas";
};

async function loadIntent(sql: Sql, tenantId: string, checkout: string): Promise<LoadedIntent | null> {
  const [intent] = await sql<{
    id: string;
    invoice_id: string;
    status: string;
    checkout_id: string;
    amount_kes: number;
  }>`select id, invoice_id, status, checkout_id, amount_kes from payment_intents
     where tenant_id = ${tenantId} and checkout_id = ${checkout}`;
  if (intent) return { ...intent, kind: "customer" };
  const [saas] = await sql<{
    id: string;
    invoice_id: string;
    status: string;
    checkout_id: string;
    amount_kes: number;
  }>`select id, invoice_id, status, checkout_id, amount_kes from saas_payment_intents
     where tenant_id = ${tenantId} and checkout_id = ${checkout}`;
  if (saas) return { ...saas, kind: "saas" };
  return null;
}

async function settleFromDecision(
  sql: Sql,
  tenant: { id: string; name: string },
  provider: string,
  intent: LoadedIntent,
  parsed: { checkout: string; resultCode: number; resultDesc: string; receipt: string; amount?: number },
) {
  const decision = evaluateStkCallback(intent, parsed);
  if (decision.action === "idempotent") return "idempotent";
  if (decision.action === "ignore") return decision.reason;
  if (decision.action === "fail") {
    if (intent.kind === "saas") {
      await sql`update saas_payment_intents set status = ${decision.intentStatus}
        where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
    } else {
      await sql`update payment_intents set status = ${decision.intentStatus}, fail_reason = ${decision.reason}
        where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
    }
    return decision.intentStatus;
  }
  if (decision.action === "reconcile") {
    if (intent.kind === "saas") {
      await sql`update saas_payment_intents set status = 'reconciliation_required'
        where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
    } else {
      await sql`update payment_intents set status = 'reconciliation_required', fail_reason = ${decision.reason}
        where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
    }
    return "reconciliation_required";
  }
  try {
    if (intent.kind === "saas") {
      await applySaasPayment(sql, {
        tenantId: tenant.id,
        invoiceId: intent.invoice_id,
        provider,
        reference: decision.reference,
        amountKes: intent.amount_kes,
      });
      await sql`update saas_payment_intents set status = 'confirmed'
        where id = ${intent.id} and tenant_id = ${tenant.id}`;
    } else {
      const pay = await applyConfirmedPayment(sql, {
        tenantId: tenant.id,
        ispName: tenant.name,
        invoiceId: intent.invoice_id,
        provider,
        reference: decision.reference,
        amountKes: intent.amount_kes,
      });
      await sql`update payment_intents set status = 'confirmed', fail_reason = ''
        where id = ${intent.id} and tenant_id = ${tenant.id}`;
      const incoming = parseStkAsIncoming(parsed);
      if (incoming) {
        await ingestIncomingPayment(sql, tenant, incoming, { autoMatch: false });
        const [inv] = await sql<{ customer_id: string }>`
          select customer_id from invoices where id = ${intent.invoice_id} and tenant_id = ${tenant.id}`;
        await sql`update incoming_payments set status = 'matched', customer_id = ${inv?.customer_id || null},
          invoice_id = ${intent.invoice_id}, payment_id = ${pay.id}, match_reason = 'stk'
          where tenant_id = ${tenant.id} and trans_id = ${incoming.transId}`;
      }
    }
    return "confirmed";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "confirm failed";
    if (/Duplicate/i.test(msg) || /already paid/i.test(msg)) {
      if (intent.kind === "saas") {
        await sql`update saas_payment_intents set status = 'confirmed' where id = ${intent.id}`;
      } else {
        await sql`update payment_intents set status = 'confirmed' where id = ${intent.id}`;
      }
      return "idempotent";
    }
    throw e;
  }
}

export async function processMpesaCallback(sql: Sql, slug: string, body: Record<string, unknown>) {
  const tenant = await tenantBySlug(sql, slug);
  if (!tenant) return { ResultCode: 0, ResultDesc: "Unknown tenant" };
  if (isC2bBody(body)) {
    const hit = parseC2bBody(body);
    await logWebhook(sql, tenant.id, "mpesa", hit?.transId || "", body, "c2b");
    if (!hit) return { ResultCode: 0, ResultDesc: "Accepted" };
    const stored = await ingestIncomingPayment(sql, tenant, hit);
    return { ResultCode: 0, ResultDesc: stored.status };
  }
  const parsed = parseMpesaCallback(body);
  await logWebhook(sql, tenant.id, "mpesa", parsed.checkout, body, String(parsed.resultCode));
  if (!parsed.checkout) {
    const loose = parseStkAsIncoming(parsed);
    if (loose) await ingestIncomingPayment(sql, tenant, loose);
    return { ResultCode: 0, ResultDesc: "Accepted" };
  }
  const intent = await loadIntent(sql, tenant.id, parsed.checkout);
  if (!intent) {
    const loose = parseStkAsIncoming({ ...parsed, amount: parsed.amount || 0 });
    if (loose) await ingestIncomingPayment(sql, tenant, loose);
    return { ResultCode: 0, ResultDesc: "unmatched" };
  }
  if (intent.status !== "confirmed" && parsed.resultCode === 0 && parsed.amount != null && Math.round(parsed.amount) !== intent.amount_kes) {
    const loose = parseStkAsIncoming(parsed);
    if (loose) await ingestIncomingPayment(sql, tenant, loose, { autoMatch: false });
  }
  const result = await settleFromDecision(sql, tenant, "mpesa", intent, parsed);
  return { ResultCode: 0, ResultDesc: result };
}

export async function handleMpesaCallback(slug: string, body: Record<string, unknown>) {
  const { getSql } = await import("../db.ts");
  return processMpesaCallback(await getSql(), slug, body);
}

export async function handleKopokopoCallback(slug: string, body: Record<string, unknown>) {
  const { getSql } = await import("../db.ts");
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
  const loaded: LoadedIntent = "kind" in intent ? (intent as LoadedIntent) : { ...intent, kind: "customer" };
  const aligned = { ...parsed, checkout: loaded.checkout_id };
  await settleFromDecision(sql, tenant, "kopokopo", loaded, aligned);
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
