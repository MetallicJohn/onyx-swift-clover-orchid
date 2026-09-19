import { nid } from "../utils.ts";
import { ensureServiceAccountNumber } from "./account-numbers.ts";
import { issueInvoice } from "./billing.ts";
import { last9Phone } from "./customer-portal-format.ts";
import { allocateCustomerId } from "./customer-ids.ts";
import { nairobiDate } from "./empty-tenant.ts";
import { emit } from "./events.ts";
import {
  addHotspotDuration,
  formatHotspotDuration,
  hotspotPackageDuration,
} from "./hotspot-duration.ts";
import { displayPhone } from "./onboard.ts";
import { AWAITING_PAYMENT } from "./onboard.ts";
import { createStkIntent, settleStkIntent } from "./payments.ts";
import { isKenyaMobile, normalizePhone } from "./phone.ts";
import { generatePppoePassword } from "./pppoe-credentials.ts";
import { syncRadiusAccount } from "./radius.ts";
import { applyRls } from "./rls.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type HotspotCatalogPackage = {
  id: string;
  name: string;
  description: string;
  price_kes: number;
  download_mbps: number;
  upload_mbps: number;
  bundle_mb: number;
  duration_value: number;
  duration_unit: string;
  duration_label: string;
  validity_hours: number;
};

export type HotspotPurchasePublic = {
  id: string;
  status: string;
  payment_status: string;
  service_status: string;
  note: string;
  package_name: string;
  amount_kes: number;
  duration_label: string;
  checkout_id: string;
  phone: string;
  username?: string;
  password?: string;
  activated_at?: string | null;
  expires_at?: string | null;
};

type PurchaseRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  service_id: string;
  package_id: string;
  invoice_id: string | null;
  intent_id: string | null;
  phone: string;
  amount_kes: number;
  payment_status: string;
  service_status: string;
  username: string;
  password: string;
  activated_at: string | null;
  expires_at: string | null;
  fail_reason: string;
};

async function tenantBySlug(sql: Sql, slug: string) {
  const asked = slug.trim().toLowerCase();
  if (!asked) throw new Error("Unknown network");
  await applyRls(sql, { bypass: true });
  const [ten] = await sql<{ id: string; name: string; slug: string }>`
    select id, name, slug from tenants where lower(slug) = ${asked}`;
  if (!ten) throw new Error("Unknown network");
  await applyRls(sql, { tenantId: ten.id, bypass: false });
  return ten;
}

export async function listHotspotCatalog(sql: Sql, slug: string): Promise<{
  slug: string;
  name: string;
  packages: HotspotCatalogPackage[];
}> {
  const ten = await tenantBySlug(sql, slug);
  const rows = await sql<{
    id: string;
    name: string;
    description: string;
    price_kes: number;
    download_mbps: number;
    upload_mbps: number;
    bundle_mb: number;
    duration_value: number;
    duration_unit: string;
    validity_hours: number;
  }>`select id, name, coalesce(description,'') as description, price_kes, download_mbps, upload_mbps,
            coalesce(bundle_mb,0)::int as bundle_mb,
            coalesce(duration_value,0)::int as duration_value, coalesce(duration_unit,'hours') as duration_unit,
            coalesce(validity_hours,0)::int as validity_hours
     from packages
     where tenant_id = ${ten.id} and access_method = 'hotspot' and active = true
     order by price_kes, name`;
  return {
    slug: ten.slug,
    name: ten.name,
    packages: rows.map((p) => {
      const dur = hotspotPackageDuration(p);
      return {
        ...p,
        duration_value: dur.value,
        duration_unit: dur.unit,
        duration_label: formatHotspotDuration(dur.value, dur.unit),
      };
    }),
  };
}

async function findCustomerByLast9(sql: Sql, tenantId: string, phone: string) {
  const last9 = last9Phone(phone);
  if (last9.length < 9) return null;
  const customers = await sql<{ id: string; phone: string; name: string }>`
    select id, phone, name from customers where tenant_id = ${tenantId} and deleted_at is null`;
  const matches = customers.filter((c) => last9Phone(c.phone) === last9);
  if (matches.length > 1) throw new Error("Could not identify the account for this phone");
  return matches[0] ?? null;
}

async function uniqueHotspotUsername(sql: Sql, tenantId: string) {
  for (let i = 0; i < 12; i += 1) {
    const username = `HS-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const [taken] = await sql<{ id: string }>`
      select id from services where tenant_id = ${tenantId} and username = ${username} limit 1`;
    if (!taken) return username;
  }
  throw new Error("Could not allocate hotspot credentials");
}

function publicNote(status: string, failReason = "") {
  if (status === "confirmed") return "Payment successful. Use the credentials below to connect.";
  if (status === "cancelled") return "The M-Pesa prompt was cancelled. You can try again.";
  if (status === "failed") return failReason && !/sql|tenant|invoice/i.test(failReason)
    ? failReason
    : "Payment failed. You can try again.";
  if (status === "reversed") return "This payment was reversed. Access was not granted.";
  if (status === "reconciliation_required") return "Payment needs review. Access is not granted yet.";
  return "M-Pesa payment request sent. Check your phone and enter your M-Pesa PIN to complete the payment.";
}

function presentPurchase(
  row: PurchaseRow,
  extra: { package_name: string; duration_label: string; checkout_id?: string },
  revealSecrets: boolean,
): HotspotPurchasePublic {
  const confirmed = row.payment_status === "confirmed" && row.service_status === "active";
  return {
    id: row.id,
    status: row.payment_status,
    payment_status: row.payment_status,
    service_status: row.service_status,
    note: publicNote(row.payment_status, row.fail_reason),
    package_name: extra.package_name,
    amount_kes: row.amount_kes,
    duration_label: extra.duration_label,
    checkout_id: extra.checkout_id || "",
    phone: row.phone,
    username: revealSecrets && confirmed ? row.username : undefined,
    password: revealSecrets && confirmed ? row.password : undefined,
    activated_at: confirmed ? row.activated_at : undefined,
    expires_at: confirmed ? row.expires_at : undefined,
  };
}

async function loadPurchase(
  sql: Sql,
  tenantId: string,
  id: string,
): Promise<(PurchaseRow & { package_name: string; duration_value: number; duration_unit: string; validity_hours: number; checkout_id: string }) | null> {
  const [row] = await sql<
    PurchaseRow & {
      package_name: string;
      duration_value: number;
      duration_unit: string;
      validity_hours: number;
      checkout_id: string;
    }
  >`
    select h.id, h.tenant_id, h.customer_id, h.service_id, h.package_id, h.invoice_id, h.intent_id,
           h.phone, h.amount_kes, h.payment_status, h.service_status, h.username, h.password,
           h.activated_at::text as activated_at, h.expires_at::text as expires_at, coalesce(h.fail_reason,'') as fail_reason,
           p.name as package_name,
           coalesce(p.duration_value,0)::int as duration_value, coalesce(p.duration_unit,'hours') as duration_unit,
           coalesce(p.validity_hours,0)::int as validity_hours,
           coalesce(i.checkout_id,'') as checkout_id
    from hotspot_purchases h
    join packages p on p.id = h.package_id
    left join payment_intents i on i.id = h.intent_id
    where h.id = ${id} and h.tenant_id = ${tenantId}`;
  return row ?? null;
}

export async function startHotspotPurchase(
  sql: Sql,
  opts: { slug: string; packageId: string; phone: string; amountKes?: number },
): Promise<HotspotPurchasePublic> {
  const ten = await tenantBySlug(sql, opts.slug);
  if (!isKenyaMobile(opts.phone)) throw new Error("Enter a valid Kenyan M-Pesa number");
  const phone = normalizePhone(opts.phone);
  const [pkg] = await sql<{
    id: string;
    name: string;
    price_kes: number;
    download_mbps: number;
    upload_mbps: number;
    duration_value: number;
    duration_unit: string;
    validity_hours: number;
    active: boolean;
    access_method: string;
  }>`select id, name, price_kes, download_mbps, upload_mbps,
            coalesce(duration_value,0)::int as duration_value, coalesce(duration_unit,'hours') as duration_unit,
            coalesce(validity_hours,0)::int as validity_hours, active, access_method
     from packages where id = ${opts.packageId} and tenant_id = ${ten.id}`;
  if (!pkg || pkg.access_method !== "hotspot" || !pkg.active) throw new Error("That package is not available");
  const amount = Math.round(pkg.price_kes);
  if (amount < 1) throw new Error("That package is not available");
  if (opts.amountKes != null && Math.round(opts.amountKes) !== amount) {
    throw new Error("Package price mismatch");
  }
  const dur = hotspotPackageDuration(pkg);
  if (dur.value < 1) throw new Error("That package has no duration");

  const last9 = last9Phone(phone);
  const [pending] = await sql<PurchaseRow & { checkout_id: string; package_name: string }>`
    select h.id, h.tenant_id, h.customer_id, h.service_id, h.package_id, h.invoice_id, h.intent_id,
           h.phone, h.amount_kes, h.payment_status, h.service_status, h.username, h.password,
           h.activated_at::text as activated_at, h.expires_at::text as expires_at, coalesce(h.fail_reason,'') as fail_reason,
           coalesce(i.checkout_id,'') as checkout_id, p.name as package_name
    from hotspot_purchases h
    join packages p on p.id = h.package_id
    left join payment_intents i on i.id = h.intent_id
    where h.tenant_id = ${ten.id} and h.package_id = ${pkg.id} and h.payment_status = 'pending'
      and right(regexp_replace(h.phone, '[^0-9]', '', 'g'), 9) = ${last9}
      and h.created_at > now() - interval '5 minutes'
    order by h.created_at desc
    limit 1`;
  if (pending) {
    return presentPurchase(pending, {
      package_name: pending.package_name,
      duration_label: formatHotspotDuration(dur.value, dur.unit),
      checkout_id: pending.checkout_id,
    }, false);
  }

  let customer = await findCustomerByLast9(sql, ten.id, phone);
  if (!customer) {
    const customerId = nid("cus");
    const accountNumber = await allocateCustomerId(sql, ten.id);
    const shown = displayPhone(phone);
    await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status, account_number)
      values (${customerId}, ${ten.id}, 'individual', ${`Hotspot ${shown}`}, ${shown}, '', '', 'active', ${accountNumber})`;
    await emit(sql, { type: "customer.created", tenantId: ten.id, payload: { id: customerId, phone: shown } });
    customer = { id: customerId, phone: shown, name: `Hotspot ${shown}` };
  }

  const username = await uniqueHotspotUsername(sql, ten.id);
  const password = generatePppoePassword();
  const serviceId = nid("svc");
  await sql`insert into services
      (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, suspend_reason, activation_mode)
    values (${serviceId}, ${ten.id}, ${customer.id}, ${pkg.id}, 'hotspot', ${username}, null, 'pending', ${AWAITING_PAYMENT}, 'after_payment')`;
  await ensureServiceAccountNumber(sql, ten.id, serviceId);
  await syncRadiusAccount(sql, ten.id, {
    id: serviceId,
    access_method: "hotspot",
    username,
    static_ip: null,
    status: "pending",
    download_mbps: pkg.download_mbps,
    upload_mbps: pkg.upload_mbps,
    password,
    package_name: pkg.name,
    suspend_reason: AWAITING_PAYMENT,
  });

  const invoice = await issueInvoice(sql, {
    tenantId: ten.id,
    customerId: customer.id,
    serviceId,
    dueDate: nairobiDate(),
    items: [
      {
        description: `${pkg.name} (${formatHotspotDuration(dur.value, dur.unit)})`,
        quantity: 1,
        unit_kes: amount,
        package_id: pkg.id,
        service_id: serviceId,
      },
    ],
  });

  const intent = await createStkIntent(sql, {
    tenantId: ten.id,
    invoiceId: invoice.id,
    provider: "mpesa",
    amountKes: amount,
    phone,
  });

  const purchaseId = nid("hsp");
  await sql`insert into hotspot_purchases
      (id, tenant_id, customer_id, service_id, package_id, invoice_id, intent_id, phone, amount_kes,
       payment_status, service_status, username, password)
    values (${purchaseId}, ${ten.id}, ${customer.id}, ${serviceId}, ${pkg.id}, ${invoice.id}, ${intent.id}, ${phone},
            ${amount}, 'pending', 'pending_payment', ${username}, ${password})`;
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${ten.id}, ${"system"}, ${"hotspot.purchase.started"}, ${"hotspot_purchase"}, ${purchaseId},
            ${JSON.stringify({ package_id: pkg.id, amount_kes: amount, phone })} )`;

  return {
    id: purchaseId,
    status: "pending",
    payment_status: "pending",
    service_status: "pending_payment",
    note: intent.note && /simulated/i.test(intent.note)
      ? "M-Pesa payment request sent. Check your phone and enter your M-Pesa PIN to complete the payment."
      : publicNote("pending"),
    package_name: pkg.name,
    amount_kes: amount,
    duration_label: formatHotspotDuration(dur.value, dur.unit),
    checkout_id: intent.checkout_id,
    phone,
  };
}

export async function syncHotspotPurchaseFromIntent(
  sql: Sql,
  tenantId: string,
  intentId: string,
  next: { payment_status: string; fail_reason?: string },
) {
  const [row] = await sql<{ id: string; payment_status: string; service_id: string }>`
    select id, payment_status, service_id from hotspot_purchases
    where tenant_id = ${tenantId} and intent_id = ${intentId}`;
  if (!row) return null;
  if (next.payment_status === "reversed") {
    await revokeHotspotPurchase(sql, tenantId, row.id, next.fail_reason || "Payment reversed");
    return row;
  }
  if (row.payment_status === "confirmed") return row;
  const serviceStatus =
    next.payment_status === "confirmed"
      ? "active"
      : next.payment_status === "cancelled"
        ? "cancelled"
        : next.payment_status === "failed"
          ? "cancelled"
          : "pending_payment";
  await sql`update hotspot_purchases
    set payment_status = ${next.payment_status},
        service_status = case when ${next.payment_status} = 'confirmed' then service_status else ${serviceStatus} end,
        fail_reason = ${String(next.fail_reason || "").slice(0, 240)},
        updated_at = now()
    where id = ${row.id} and tenant_id = ${tenantId} and payment_status <> 'confirmed'`;
  return row;
}

async function revokeHotspotPurchase(sql: Sql, tenantId: string, purchaseId: string, failReason: string) {
  const [row] = await sql<{ service_id: string; payment_status: string }>`
    select service_id, payment_status from hotspot_purchases
    where id = ${purchaseId} and tenant_id = ${tenantId}`;
  if (!row) return;
  await sql`update hotspot_purchases
    set payment_status = 'reversed', service_status = 'cancelled',
        fail_reason = ${failReason.slice(0, 240)}, updated_at = now()
    where id = ${purchaseId} and tenant_id = ${tenantId}`;
  await sql`update services
    set status = 'suspended', suspend_reason = ${"reversed_payment"}
    where id = ${row.service_id} and tenant_id = ${tenantId} and deleted_at is null and status <> 'terminated'`;
  const { provisionServiceAccess } = await import("./access.ts");
  await provisionServiceAccess(sql, tenantId, row.service_id);
}

export async function fulfillHotspotPurchase(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  now = new Date(),
) {
  const [row] = await sql<{
    id: string;
    payment_status: string;
    duration_value: number;
    duration_unit: string;
    username: string;
    period_end: string | null;
  }>`select h.id, h.payment_status, coalesce(p.duration_value,0)::int as duration_value,
            coalesce(p.duration_unit,'hours') as duration_unit, h.username, s.period_end::text as period_end
     from hotspot_purchases h
     join packages p on p.id = h.package_id
     join services s on s.id = h.service_id
     where h.tenant_id = ${tenantId} and h.service_id = ${serviceId}
     order by h.created_at desc
     limit 1`;
  if (!row) return null;
  const dur = hotspotPackageDuration(row);
  const expires = row.period_end ? new Date(row.period_end) : addHotspotDuration(now, dur.value, dur.unit);
  await sql`update hotspot_purchases
    set payment_status = 'confirmed',
        service_status = 'active',
        activated_at = coalesce(activated_at, ${now.toISOString()}),
        expires_at = ${expires.toISOString()},
        fail_reason = '',
        updated_at = now()
    where id = ${row.id} and tenant_id = ${tenantId}`;
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${"system"}, ${"hotspot.purchase.confirmed"}, ${"hotspot_purchase"}, ${row.id},
            ${JSON.stringify({ service_id: serviceId, username: row.username, expires_at: expires.toISOString() })} )`;
  return row;
}

export async function pollHotspotPurchase(
  sql: Sql,
  opts: { slug: string; purchaseId: string },
): Promise<HotspotPurchasePublic> {
  const ten = await tenantBySlug(sql, opts.slug);
  const row = await loadPurchase(sql, ten.id, opts.purchaseId);
  if (!row) throw new Error("Payment request not found");

  if (row.payment_status === "pending" && row.checkout_id) {
    const [intent] = row.intent_id
      ? await sql<{ status: string }>`select status from payment_intents where id = ${row.intent_id} and tenant_id = ${ten.id}`
      : [];
    if (!intent || intent.status === "pending") {
      try {
        await settleStkIntent(sql, { tenantId: ten.id, ispName: ten.name, checkoutId: row.checkout_id });
      } catch {
        /* still waiting, cancelled, or live provider refused simulated confirm */
      }
    }
  }

  const live = (await loadPurchase(sql, ten.id, opts.purchaseId)) || row;
  const durLive = hotspotPackageDuration(live);
  return presentPurchase(live, {
    package_name: live.package_name,
    duration_label: formatHotspotDuration(durLive.value, durLive.unit),
    checkout_id: live.checkout_id,
  }, live.payment_status === "confirmed" && live.service_status === "active");
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

export function publicPurchaseError(err: unknown) {
  const msg = err instanceof Error ? err.message : "Could not start payment";
  if (/unknown network/i.test(msg)) return { status: 404, error: "Unknown network" };
  if (/not available/i.test(msg)) return { status: 404, error: "That package is not available" };
  if (/mpesa number|phone/i.test(msg)) return { status: 400, error: "Enter a valid Kenyan M-Pesa number" };
  if (/price mismatch/i.test(msg)) return { status: 400, error: "Package price mismatch" };
  if (/not found/i.test(msg)) return { status: 404, error: "Payment request not found" };
  if (/identify/i.test(msg)) return { status: 409, error: "Could not identify the account for this phone" };
  if (/disabled/i.test(msg)) return { status: 400, error: "M-Pesa is not available on this network" };
  return { status: 400, error: msg.slice(0, 180) };
}
