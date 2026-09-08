import { getSql } from "@/lib/db";
import { nid } from "@/lib/utils";
import { applyConfirmedPayment } from "./payments";
import { ensureOpsSchema } from "./ops-schema";

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

function metaItem(body: Record<string, unknown>, name: string) {
  const stk = (body.Body as Record<string, unknown> | undefined)?.stkCallback as Record<string, unknown> | undefined;
  const meta = stk?.CallbackMetadata as { Item?: Array<{ Name?: string; Value?: unknown }> } | undefined;
  const hit = meta?.Item?.find((i) => i.Name === name);
  return hit?.Value;
}

export async function handleMpesaCallback(slug: string, body: Record<string, unknown>) {
  const sql = await getSql();
  await ensureOpsSchema(sql);
  const tenant = await tenantBySlug(sql, slug);
  if (!tenant) return { ResultCode: 0, ResultDesc: "Unknown tenant" };

  const stk = (body.Body as Record<string, unknown> | undefined)?.stkCallback as
    | {
        CheckoutRequestID?: string;
        ResultCode?: number;
        ResultDesc?: string;
      }
    | undefined;
  const checkout = stk?.CheckoutRequestID || "";
  await logWebhook(sql, tenant.id, "mpesa", checkout, body, String(stk?.ResultCode ?? "received"));

  if (!checkout) return { ResultCode: 0, ResultDesc: "Accepted" };
  if (stk?.ResultCode !== 0) return { ResultCode: 0, ResultDesc: "Recorded failure" };

  const receipt = String(metaItem(body, "MpesaReceiptNumber") || checkout);
  const [intent] = await sql<{ id: string; invoice_id: string; status: string }>`
    select id, invoice_id, status from payment_intents
    where tenant_id = ${tenant.id} and checkout_id = ${checkout}`;
  if (!intent) return { ResultCode: 0, ResultDesc: "Unknown checkout" };
  if (intent.status === "confirmed") return { ResultCode: 0, ResultDesc: "Already confirmed" };

  try {
    await applyConfirmedPayment(sql, {
      tenantId: tenant.id,
      ispName: tenant.name,
      invoiceId: intent.invoice_id,
      provider: "mpesa",
      reference: receipt,
    });
    await sql`update payment_intents set status = 'confirmed' where id = ${intent.id}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "confirm failed";
    if (!/Duplicate/i.test(msg)) throw e;
  }
  return { ResultCode: 0, ResultDesc: "Accepted" };
}

export async function handleKopokopoCallback(slug: string, body: Record<string, unknown>) {
  const sql = await getSql();
  await ensureOpsSchema(sql);
  const tenant = await tenantBySlug(sql, slug);
  if (!tenant) return { ok: false };

  const data = body.data as Record<string, unknown> | undefined;
  const attrs = data?.attributes as Record<string, unknown> | undefined;
  const event = (body.event as Record<string, unknown> | undefined) || (attrs?.event as Record<string, unknown> | undefined);
  const resource = (event?.resource as Record<string, unknown> | undefined) || {};
  const checkout = String(data?.id || body.id || resource.id || "");
  const status = String(attrs?.status || resource.status || "");
  const reference = String(resource.reference || checkout);
  await logWebhook(sql, tenant.id, "kopokopo", checkout, body, status || "received");

  const ok = /success|received/i.test(status) || status === "";
  if (!ok || !checkout) return { ok: true };

  const [intent] = await sql<{ id: string; invoice_id: string; status: string }>`
    select id, invoice_id, status from payment_intents
    where tenant_id = ${tenant.id} and (checkout_id = ${checkout} or checkout_id like ${"%" + checkout})`;
  if (!intent || intent.status === "confirmed") return { ok: true };

  try {
    await applyConfirmedPayment(sql, {
      tenantId: tenant.id,
      ispName: tenant.name,
      invoiceId: intent.invoice_id,
      provider: "kopokopo",
      reference,
    });
    await sql`update payment_intents set status = 'confirmed' where id = ${intent.id}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (!/Duplicate/i.test(msg)) throw e;
  }
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
