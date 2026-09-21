import { nid } from "../utils.ts";
import { provisionServiceAccess } from "./access.ts";
import { allocateStaticIp, assignStaticIp } from "./access-service.ts";
import { ensureServiceAccountNumber } from "./account-numbers.ts";
import { allocateCustomerId, getCustomerIdSettings } from "./customer-ids.ts";
import { enqueueAgentCommand } from "./agent.ts";
import { issueInvoice } from "./billing.ts";
import { last9Phone } from "./customer-portal-format.ts";
import { likeNeedle } from "./customer-desk-format.ts";
import { nairobiDate } from "./empty-tenant.ts";
import { emit } from "./events.ts";
import { buildServiceNotifyVars, notifyQuietly } from "./notifications.ts";
import {
  AWAITING_PAYMENT,
  billingAnchorYmd,
  defaultExpiryYmd,
  firstError,
  isMigratingOnboard,
  sanitizePayload,
  scoreDuplicate,
  storedAccessFields,
  validatePayload,
  type DuplicateMatch,
  type OnboardPayload,
  type OnboardServiceDraft,
} from "./onboard.ts";
import { PPPOE_USERNAME_IN_USE, usernameTaken } from "./pppoe-credentials.ts";
import { startPppoeProvision } from "./pppoe-provision.ts";
import { syncRadiusAccount } from "./radius.ts";
import { parseExpiryYmd } from "./service-expiry-format.ts";
import { parseFlexibleYmd } from "./onboard-import-format.ts";
import { setCustomerTags } from "./tags.ts";
import type { AccessMethod, PackageRow } from "./types.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type OnboardCatalogCpe = {
  id: string;
  serial: string;
  product_class: string;
  manufacturer: string;
  status: string;
  last_inform: string | null;
  customer_id: string | null;
  customer_name: string | null;
  service_id: string | null;
  assigned: boolean;
  newly_discovered: boolean;
};

export type OnboardCatalog = {
  packages: PackageRow[];
  tags: { id: string; name: string; enabled: boolean }[];
  pools: { id: string; name: string; cidr: string }[];
  devices: OnboardCatalogCpe[];
  routers: { id: string; name: string }[];
  account: {
    enabled: boolean;
    allow_manual: boolean;
    preview: string;
    scheme: "random" | "sequence";
  };
  customer_id: {
    configured: boolean;
    issued: boolean;
    locked: boolean;
    start_n: number;
    next_preview: string;
  };
  partial: {
    enabled_default: boolean;
    allow_service_override: boolean;
    min_pct: number;
    can_activate_new: boolean;
    can_offer: boolean;
  };
};

export type OnboardCustomerHit = {
  id: string;
  name: string;
  phone: string;
  email: string;
  account_number: string;
  type: string;
  address: string;
  service_count: number;
};

export type OnboardResult = {
  customer_id: string;
  service_id: string | null;
  invoice_id: string | null;
  account_number: string;
  customer_account_number: string;
  username: string | null;
  password: string | null;
  static_ip: string | null;
  status: string | null;
  activation: string | null;
  provision_overall: string | null;
  partial_error: string | null;
};

async function audit(
  sql: Sql,
  tenantId: string,
  userId: string,
  action: string,
  entityType = "",
  entityId = "",
  details = "",
) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, ${entityType}, ${entityId}, ${details})`;
}

export async function loadOnboardCatalog(sql: Sql, tenantId: string, slug = ""): Promise<OnboardCatalog> {
  const packages = await sql<PackageRow>`
    select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active
    from packages where tenant_id = ${tenantId} and active = true order by access_method, price_kes, name`;
  const { listTags } = await import("./tags.ts");
  const tags = await listTags(sql, tenantId);
  const pools = await sql<{ id: string; name: string; cidr: string }>`
    select id, name, cidr from ip_pools where tenant_id = ${tenantId} order by name`;
  const routers = await sql<{ id: string; name: string }>`
    select id, name from routers where tenant_id = ${tenantId} order by name`;
  const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
  const devices = await sql<{
    id: string;
    serial: string;
    product_class: string;
    manufacturer: string;
    status: string;
    last_inform: string | null;
    customer_id: string | null;
    customer_name: string | null;
    service_id: string | null;
  }>`
    select d.id, d.serial, coalesce(d.product_class,'') as product_class,
           coalesce(d.manufacturer_oui,'') as manufacturer, d.status,
           d.last_inform::text as last_inform, d.customer_id,
           case when c.deleted_at is null then c.name else null end as customer_name,
           d.service_id
    from cpe_devices d
    left join customers c on c.id = d.customer_id
    where d.tenant_id = ${tenantId}
    order by d.last_inform desc nulls last, d.serial`;
  const { getAccountNumberSettings, previewNextAccountNumber } = await import("./account-numbers.ts");
  const settings = await getAccountNumberSettings(sql, tenantId, slug);
  const preview = await previewNextAccountNumber(sql, tenantId, slug);
  const customerIdDesk = await getCustomerIdSettings(sql, tenantId);
  const { getPartialPolicy } = await import("./partial-payment.ts");
  const partial = await getPartialPolicy(sql, tenantId);
  const canOffer = Boolean(partial.enabled_default || partial.allow_service_override);
  return {
    packages,
    tags: tags.map((t) => ({ id: t.id, name: t.name, enabled: t.enabled })),
    pools,
    routers,
    devices: devices.map((d) => ({
      ...d,
      assigned: Boolean(d.service_id),
      newly_discovered: Boolean(d.last_inform && d.last_inform >= cutoff),
    })),
    account: {
      enabled: settings.enabled,
      allow_manual: settings.allow_manual,
      preview: preview.preview,
      scheme: settings.scheme === "sequence" ? "sequence" : "random",
    },
    customer_id: {
      configured: customerIdDesk.configured,
      issued: customerIdDesk.issued,
      locked: customerIdDesk.locked,
      start_n: customerIdDesk.start_n,
      next_preview: customerIdDesk.next_preview,
    },
    partial: {
      enabled_default: partial.enabled_default,
      allow_service_override: partial.allow_service_override,
      min_pct: partial.default_min_pct,
      can_activate_new: partial.can_activate_new,
      can_offer: canOffer && partial.can_activate_new,
    },
  };
}

export async function searchOnboardCustomers(sql: Sql, tenantId: string, q: string): Promise<OnboardCustomerHit[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const like = likeNeedle(needle);
  const last9 = last9Phone(needle);
  const rows = await sql<OnboardCustomerHit>`
    select c.id, c.name, c.phone, c.email, coalesce(c.account_number,'') as account_number,
           c.type, c.address,
           (select count(*)::int from services s where s.tenant_id = c.tenant_id and s.customer_id = c.id and s.deleted_at is null) as service_count
    from customers c
    where c.tenant_id = ${tenantId} and c.deleted_at is null
      and (
        c.name ilike ${like} escape '#'
        or c.phone ilike ${like} escape '#'
        or c.email ilike ${like} escape '#'
        or coalesce(c.account_number,'') ilike ${like} escape '#'
        or (${last9.length >= 9} and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 9) = ${last9})
      )
    order by c.name
    limit 8`;
  return rows;
}

export async function findCustomerDuplicates(
  sql: Sql,
  tenantId: string,
  draft: { name: string; phone: string; email: string },
  exceptId?: string,
): Promise<DuplicateMatch[]> {
  const rows = await sql<{ id: string; name: string; phone: string; email: string; account_number: string }>`
    select id, name, phone, email, coalesce(account_number,'') as account_number
    from customers where tenant_id = ${tenantId} and deleted_at is null`;
  const hits: DuplicateMatch[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (exceptId && row.id === exceptId) continue;
    const match = scoreDuplicate(draft, row);
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      hits.push(match);
    }
  }
  hits.sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return hits;
}

async function loadCpe(
  sql: Sql,
  tenantId: string,
  cpeId: string,
) {
  const [cpe] = await sql<{
    id: string;
    customer_id: string | null;
    service_id: string | null;
    serial: string;
    status: string;
  }>`select id, customer_id, service_id, serial, status
     from cpe_devices where id = ${cpeId} and tenant_id = ${tenantId}`;
  if (!cpe) throw new Error("CPE not found on this network");
  return cpe;
}

async function assertCpeAttachable(
  sql: Sql,
  tenantId: string,
  opts: { cpeId: string; customerId: string },
) {
  const cpe = await loadCpe(sql, tenantId, opts.cpeId);
  if (cpe.service_id) throw new Error("This CPE is already assigned to another service");
  if (cpe.customer_id && cpe.customer_id !== opts.customerId) {
    throw new Error("This CPE is linked to a different customer");
  }
  return cpe;
}

async function attachCpe(
  sql: Sql,
  tenantId: string,
  opts: { cpeId: string; customerId: string; serviceId: string },
) {
  const cpe = await assertCpeAttachable(sql, tenantId, opts);
  await sql`update cpe_devices
    set customer_id = ${opts.customerId}, service_id = ${opts.serviceId}
    where id = ${cpe.id} and tenant_id = ${tenantId}`;
  return { id: cpe.id, serial: cpe.serial, status: cpe.status };
}

async function issueServiceInvoice(
  sql: Sql,
  opts: {
    tenantId: string;
    tenantName: string;
    customerId: string;
    serviceId: string;
    packageId: string;
    packageName: string;
    interval: string;
    priceKes: number;
    dueDate: string;
  },
) {
  if (opts.priceKes <= 0) return null;
  const unpaid = await sql<{ id: string }>`
    select i.id from invoices i
    join invoice_items li on li.invoice_id = i.id
    where i.tenant_id = ${opts.tenantId} and i.customer_id = ${opts.customerId}
      and li.service_id = ${opts.serviceId}
      and i.status in ('issued','due','overdue','partial')
    limit 1`;
  if (unpaid[0]) return { id: unpaid[0].id, number: "", amount_kes: 0, skipped: true as const };
  const dueDate = opts.dueDate || nairobiDate();
  const inv = await issueInvoice(sql, {
    tenantId: opts.tenantId,
    customerId: opts.customerId,
    serviceId: opts.serviceId,
    dueDate,
    items: [
      {
        description: `${opts.packageName} (${opts.interval})`,
        quantity: 1,
        unit_kes: opts.priceKes,
        package_id: opts.packageId,
        service_id: opts.serviceId,
      },
    ],
  });
  try {
    await notifyQuietly(sql, opts.tenantId, opts.tenantName, opts.customerId, "invoice.created", inv.id, {
      customer_name: "",
      invoice_number: inv.number,
      amount: `KES ${inv.amount_kes}`,
      due_date: dueDate,
    });
  } catch {
    /* invoice stands even if the notice fails */
  }
  return { ...inv, skipped: false as const };
}

function resolveOnboardExpiry(
  service: OnboardServiceDraft,
  pkg: { billing_interval: string; validity_hours: number },
  canOverrideExpiry: boolean,
) {
  const migrating = isMigratingOnboard(service.onboarding_type);
  let expiryYmd = "";
  if (service.expiry_ymd) {
    try {
      expiryYmd = parseFlexibleYmd(service.expiry_ymd);
    } catch {
      expiryYmd = service.expiry_ymd;
    }
  }
  if (migrating) {
    if (!expiryYmd) throw new Error("Continuing clients need the existing subscription expiry date");
    return {
      expiryYmd,
      expirySource: "billing" as const,
      billingAnchor: billingAnchorYmd(expiryYmd) || expiryYmd,
      migrating: true,
    };
  }
  const staffPicked = Boolean(canOverrideExpiry && expiryYmd);
  const ymd = staffPicked ? expiryYmd : defaultExpiryYmd(pkg, service.activation);
  return {
    expiryYmd: ymd,
    expirySource: (staffPicked ? "staff" : "billing") as "staff" | "billing",
    billingAnchor: null as string | null,
    migrating: false,
  };
}

export async function createOnboard(
  sql: Sql,
  opts: {
    tenantId: string;
    tenantName: string;
    actorId: string;
    input: OnboardPayload;
    canActivateNow?: boolean;
    canOverrideExpiry?: boolean;
  },
): Promise<OnboardResult> {
  const payload = sanitizePayload(opts.input);
  const tid = opts.tenantId;
  let pkg: {
    id: string;
    name: string;
    access_method: AccessMethod;
    price_kes: number;
    billing_interval: string;
    validity_hours: number;
    download_mbps: number;
    upload_mbps: number;
    active: boolean;
  } | null = null;
  if (payload.include_service && payload.service?.package_id) {
    const [row] = await sql<{
      id: string;
      name: string;
      access_method: AccessMethod;
      price_kes: number;
      billing_interval: string;
      validity_hours: number;
      download_mbps: number;
      upload_mbps: number;
      active: boolean;
    }>`select id, name, access_method, price_kes, billing_interval, validity_hours, download_mbps, upload_mbps, active
       from packages where id = ${payload.service.package_id} and tenant_id = ${tid}`;
    pkg = row ?? null;
  }
  const errors = validatePayload(payload, pkg);
  const message = firstError(errors);
  if (message) throw new Error(message);

  let customerId = payload.customer_id || "";
  let customerAccountNumber = "";
  let createdCustomer = false;

  if (payload.customer_mode === "existing") {
    const [cus] = await sql<{ id: string; account_number: string }>`
      select id, coalesce(account_number,'') as account_number
      from customers where id = ${customerId} and tenant_id = ${tid} and deleted_at is null`;
    if (!cus) throw new Error("Customer not found");
    customerId = cus.id;
    customerAccountNumber = cus.account_number;
  } else {
    const draft = payload.customer!;
    const { assertUniqueCustomerPhone, ensureInitialPortalPassword, setPortalPassword } = await import("./portal.ts");
    const dupes = await findCustomerDuplicates(sql, tid, draft);
    const blocking = dupes.filter((d) => d.blocking);
    if (blocking[0]) throw new Error("A customer with this phone already exists on this network");
    if (dupes.length && !payload.acknowledge_duplicates) {
      throw new Error("Possible duplicate customer. Confirm before creating.");
    }
    await assertUniqueCustomerPhone(sql, tid, draft.phone);
    customerId = nid("cus");
    customerAccountNumber = await allocateCustomerId(sql, tid);
    try {
      await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status, account_number, notes)
        values (${customerId}, ${tid}, ${draft.type}, ${draft.name}, ${draft.phone}, ${draft.email}, ${draft.address}, 'active', ${customerAccountNumber}, ${draft.notes})`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/account_number|unique/i.test(msg)) throw new Error("ID already assigned.");
      throw err;
    }
    createdCustomer = true;
    if (draft.portal_password) {
      await setPortalPassword(sql, tid, customerId, draft.portal_password);
    } else {
      await ensureInitialPortalPassword(sql, tid, customerId, draft.phone);
    }
    if (draft.tag_ids.length) await setCustomerTags(sql, tid, customerId, draft.tag_ids);
    await emit(sql, {
      type: "customer.created",
      tenantId: tid,
      payload: { customer_id: customerId, phone: draft.phone, name: draft.name },
    });
    await audit(sql, tid, opts.actorId, "customer.created", "customer", customerId);
    const sendOnboard =
      payload.service ? payload.service.send_onboarding_notification : true;
    if (sendOnboard) {
      try {
        const customerVars = await buildServiceNotifyVars(sql, tid, opts.tenantName, { customerId });
        await notifyQuietly(sql, tid, opts.tenantName, customerId, "customer.created", customerId, customerVars);
      } catch {
        /* SMS must not roll back a saved customer */
      }
    }
  }

  if (!payload.include_service || !payload.service || !pkg) {
    return {
      customer_id: customerId,
      service_id: null,
      invoice_id: null,
      account_number: customerAccountNumber,
      customer_account_number: customerAccountNumber,
      username: null,
      password: null,
      static_ip: null,
      status: null,
      activation: null,
      provision_overall: null,
      partial_error: null,
    };
  }

  const service = payload.service;
  const fields = storedAccessFields(service);
  let createdServiceId: string | null = null;
  try {
    if (fields.username && (await usernameTaken(sql, tid, fields.username))) {
      if (pkg.access_method === "pppoe" && service.auto_username === false) {
        throw new Error(PPPOE_USERNAME_IN_USE);
      }
      if (pkg.access_method !== "pppoe") {
        throw new Error("That username is already in use on this network");
      }
    }
    if (fields.cpe_id) {
      await assertCpeAttachable(sql, tid, { cpeId: fields.cpe_id, customerId });
    }
    if (pkg.access_method === "static" && !fields.static_ip) {
      const [pool] = fields.pool_id
        ? await sql<{ id: string }>`select id from ip_pools where id = ${fields.pool_id} and tenant_id = ${tid}`
        : await sql<{ id: string }>`select id from ip_pools where tenant_id = ${tid} order by name limit 1`;
      if (!pool) throw new Error("No IP pool configured. Enter a static IP, or add a pool first.");
    }
    const id = nid("svc");
    const canOverrideExpiry = opts.canOverrideExpiry ?? true;
    const canActivateNow = opts.canActivateNow ?? true;
    const migrating = isMigratingOnboard(service.onboarding_type);
    if (service.activation === "active" && pkg.price_kes > 0 && !canActivateNow && !migrating) {
      throw new Error("Only authorised staff can start a paid service as Active");
    }
    const resolved = resolveOnboardExpiry(service, pkg, canOverrideExpiry);
    const expiryYmd = resolved.expiryYmd;
    const parsed = parseExpiryYmd(expiryYmd);
    const periodEnd = parsed.accessUntil.toISOString();
    const accessUntil = parsed.accessUntil.toISOString();
    const expirySource = resolved.expirySource;
    const afterPay = service.activation === "after_payment" || service.activation === "after_partial";
    if (service.activation === "after_partial") {
      const { getPartialPolicy } = await import("./partial-payment.ts");
      const partial = await getPartialPolicy(sql, tid);
      if (!partial.can_activate_new || (!partial.enabled_default && !partial.allow_service_override)) {
        throw new Error("Partial payment is not available for new services on this network");
      }
    }
    const preserveLive = migrating && Boolean(fields.username);
    const insertStatus = afterPay || (pkg.access_method === "pppoe" && !preserveLive) ? "pending" : "active";
    const suspendReason = afterPay ? AWAITING_PAYMENT : "";
    const mac = fields.mac_address || "";
    const serviceName = (service.name || pkg.name || "").trim().slice(0, 80);
    const enablePartial = service.activation === "after_partial";
    let startYmd: string | null = null;
    if (service.subscription_start_ymd) {
      try {
        startYmd = parseFlexibleYmd(service.subscription_start_ymd);
      } catch {
        startYmd = null;
      }
    }
    const billingAnchor = resolved.billingAnchor;
    await sql`insert into services
      (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end, access_until, expiry_source, expiry_change_reason, suspend_reason, notes, mac_address, name, activation_mode, partial_enabled, onboarding_type, subscription_start_date, billing_anchor_date, send_onboarding_notification, import_source, import_batch_id)
      values (
        ${id}, ${tid}, ${customerId}, ${pkg.id}, ${pkg.access_method}, ${fields.username}, ${fields.static_ip},
        ${insertStatus}, ${periodEnd}, ${accessUntil}, ${expirySource},
        ${expirySource === "staff" ? "set_on_create" : ""}, ${suspendReason}, ${service.notes}, ${mac}, ${serviceName},
        ${service.activation}, ${enablePartial ? true : null},
        ${service.onboarding_type}, ${startYmd}, ${billingAnchor}, ${Boolean(service.send_onboarding_notification)},
        ${service.import_source || ""}, ${service.import_batch_id || null}
      )`;
    createdServiceId = id;
    const serviceAccountNumber = await ensureServiceAccountNumber(sql, tid, id);

    if (pkg.access_method !== "hotspot") {
      const { ensureServiceWifi } = await import("./acs-service-provision.ts");
      const [cusName] = await sql<{ name: string }>`select name from customers where id = ${customerId} and tenant_id = ${tid}`;
      await ensureServiceWifi(sql, tid, id, {
        ssid: service.wifi_ssid,
        password: service.wifi_password,
        customerName: cusName?.name || payload.customer?.name || "",
        accountNumber: serviceAccountNumber,
      });
    }

    if (pkg.access_method === "static") {
      if (fields.static_ip) {
        await assignStaticIp(sql, tid, id, customerId, fields.static_ip, fields.pool_id);
      } else {
        await allocateStaticIp(sql, tid, id, customerId, fields.pool_id);
      }
    }

    if (fields.cpe_id) {
      await attachCpe(sql, tid, { cpeId: fields.cpe_id, customerId, serviceId: id });
    }

    let username: string | null = fields.username;
    let password: string | null = null;
    let provisionOverall: string | null = null;

    if (pkg.access_method === "pppoe") {
      if (preserveLive) {
        username = fields.username;
        await sql`update services set username = ${username},
            status = ${afterPay ? "pending" : "active"},
            suspend_reason = ${afterPay ? AWAITING_PAYMENT : ""}
          where id = ${id} and tenant_id = ${tid}`;
        const radius = await syncRadiusAccount(sql, tid, {
          id,
          access_method: "pppoe",
          username,
          static_ip: fields.static_ip || null,
          status: afterPay ? "pending" : "active",
          package_name: pkg.name,
          download_mbps: pkg.download_mbps,
          upload_mbps: pkg.upload_mbps,
          password: service.pppoe_password || undefined,
          suspend_reason: afterPay ? AWAITING_PAYMENT : "",
        });
        password = afterPay ? null : service.pppoe_password || radius.password || null;
        provisionOverall = "pending";
        await audit(
          sql,
          tid,
          opts.actorId,
          "service.pppoe.preserved",
          "service",
          id,
          JSON.stringify({ username, import: true }),
        );
      } else {
        const provision = await startPppoeProvision(sql, tid, {
          serviceId: id,
          cpeId: fields.cpe_id,
          manualUsername: fields.username || undefined,
          manualPassword: service.pppoe_password || undefined,
          strictUsername: service.auto_username === false,
        });
        username = provision.username;
        password = provision.password || null;
        provisionOverall = provision.overall;
        if (afterPay) {
          await sql`update services set status = 'pending', suspend_reason = ${AWAITING_PAYMENT}
            where id = ${id} and tenant_id = ${tid}`;
          const [svc] = await sql<{
            username: string | null;
            static_ip: string | null;
            download_mbps: number;
            upload_mbps: number;
          }>`select s.username, s.static_ip, p.download_mbps, p.upload_mbps
             from services s join packages p on p.id = s.package_id
             where s.id = ${id} and s.tenant_id = ${tid}`;
          await syncRadiusAccount(sql, tid, {
            id,
            access_method: "pppoe",
            username: svc?.username || username,
            static_ip: svc?.static_ip || null,
            status: "pending",
            package_name: pkg.name,
            download_mbps: svc?.download_mbps,
            upload_mbps: svc?.upload_mbps,
            suspend_reason: AWAITING_PAYMENT,
          });
        } else {
          await sql`update services set status = 'active', suspend_reason = ''
            where id = ${id} and tenant_id = ${tid} and status <> 'terminated'`;
          await provisionServiceAccess(sql, tid, id);
        }
        await audit(
          sql,
          tid,
          opts.actorId,
          "service.pppoe.provision",
          "service",
          id,
          JSON.stringify({ username, cpe_id: fields.cpe_id || "", overall: provisionOverall || "" }),
        );
      }
    } else {
      if (pkg.access_method === "hotspot") {
        const [cus] = await sql<{ name: string; phone: string; account_number: string }>`
          select name, phone, coalesce(account_number,'') as account_number
          from customers where id = ${customerId} and tenant_id = ${tid}`;
        const { allocatePppoeUsername, suggestPppoeUsername } = await import("./pppoe-credentials.ts");
        const preferred =
          fields.username ||
          (service.hotspot_mode === "voucher"
            ? `hs${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`
            : suggestPppoeUsername({
                accountNumber: cus?.account_number,
                phone: cus?.phone,
                name: cus?.name,
                serviceId: id,
              }));
        username = await allocatePppoeUsername(sql, tid, id, preferred);
        await sql`update services set username = ${username} where id = ${id} and tenant_id = ${tid}`;
        if (service.hotspot_mode === "voucher" && username) {
          const hours = Math.max(1, pkg.validity_hours || (pkg.billing_interval === "daily" ? 24 : 720));
          await sql`insert into hotspot_vouchers
            (id, tenant_id, package_id, code, hours, status, service_id, customer_id, used_at, expires_at)
            values (
              ${nid("vch")}, ${tid}, ${pkg.id}, ${username}, ${hours},
              ${afterPay ? "unused" : "active"}, ${id}, ${customerId},
              ${afterPay ? null : new Date().toISOString()}, ${periodEnd}
            )`;
        }
      }
      if (migrating) {
        const [row] = await sql<{ username: string | null; static_ip: string | null }>`
          select username, static_ip from services where id = ${id} and tenant_id = ${tid}`;
        const radius = await syncRadiusAccount(sql, tid, {
          id,
          access_method: pkg.access_method,
          username: row?.username || username,
          static_ip: row?.static_ip || null,
          status: afterPay ? "pending" : "active",
          package_name: pkg.name,
          download_mbps: pkg.download_mbps,
          upload_mbps: pkg.upload_mbps,
          password: service.pppoe_password || undefined,
          suspend_reason: afterPay ? AWAITING_PAYMENT : "",
        });
        username = radius.username || username;
        password = afterPay ? null : radius.password || null;
        if (afterPay) {
          await sql`update services set status = 'pending', suspend_reason = ${AWAITING_PAYMENT}
            where id = ${id} and tenant_id = ${tid}`;
        }
      } else {
        const radius = await provisionServiceAccess(sql, tid, id);
        username = radius?.username || username;
        password = radius && afterPay ? null : radius?.password || null;
        if (afterPay) {
          await sql`update services set status = 'pending', suspend_reason = ${AWAITING_PAYMENT}
            where id = ${id} and tenant_id = ${tid}`;
          const [row] = await sql<{ username: string | null; static_ip: string | null }>`
            select username, static_ip from services where id = ${id} and tenant_id = ${tid}`;
          await syncRadiusAccount(sql, tid, {
            id,
            access_method: pkg.access_method,
            username: row?.username || username,
            static_ip: row?.static_ip || null,
            status: "pending",
            package_name: pkg.name,
            download_mbps: pkg.download_mbps,
            upload_mbps: pkg.upload_mbps,
            suspend_reason: AWAITING_PAYMENT,
          });
        }
        if (service.router_id && !afterPay) {
          const [liveRow] = await sql<{ static_ip: string | null; username: string | null }>`
            select static_ip, username from services where id = ${id} and tenant_id = ${tid}`;
          await enqueueAgentCommand(
            sql,
            tid,
            `${pkg.access_method}.upsert`,
            {
              service_id: id,
              username: liveRow?.username || username,
              static_ip: liveRow?.static_ip,
              status: afterPay ? "pending" : "active",
              package: pkg.name,
              download_mbps: pkg.download_mbps,
              upload_mbps: pkg.upload_mbps,
            },
            service.router_id,
          );
        }
      }
    }

    const [live] = await sql<{
      status: string;
      username: string | null;
      static_ip: string | null;
      suspend_reason: string;
    }>`select status, username, static_ip, coalesce(suspend_reason,'') as suspend_reason
       from services where id = ${id} and tenant_id = ${tid}`;

    let invoiceId: string | null = null;
    const invoiceDue = expiryYmd || nairobiDate(periodEnd);
    if (!migrating && pkg.price_kes > 0 && afterPay) {
      const inv = await issueServiceInvoice(sql, {
        tenantId: tid,
        tenantName: opts.tenantName,
        customerId,
        serviceId: id,
        packageId: pkg.id,
        packageName: pkg.name,
        interval: pkg.billing_interval,
        priceKes: pkg.price_kes,
        dueDate: invoiceDue,
      });
      invoiceId = inv && !inv.skipped ? inv.id : inv?.id || null;
    } else if (!migrating && pkg.price_kes > 0 && !afterPay) {
      const inv = await issueServiceInvoice(sql, {
        tenantId: tid,
        tenantName: opts.tenantName,
        customerId,
        serviceId: id,
        packageId: pkg.id,
        packageName: pkg.name,
        interval: pkg.billing_interval,
        priceKes: pkg.price_kes,
        dueDate: invoiceDue,
      });
      invoiceId = inv && !inv.skipped ? inv.id : null;
    }

    await audit(
      sql,
      tid,
      opts.actorId,
      "service.created",
      "service",
      id,
      JSON.stringify({
        activation: service.activation,
        access_method: pkg.access_method,
        expiry: expiryYmd,
        onboarding_type: service.onboarding_type,
        billing_anchor: billingAnchor || "",
        account_number: serviceAccountNumber,
      }),
    );

    if (service.send_onboarding_notification) {
      try {
        const notifyVars = await buildServiceNotifyVars(sql, tid, opts.tenantName, {
          customerId,
          serviceId: id,
          amountKes: pkg.price_kes,
          invoiceNumber: invoiceId || "",
          dueDate: expiryYmd,
        });
        const createdEvent = afterPay ? "service.created.awaiting_payment" : "service.created.active";
        await notifyQuietly(sql, tid, opts.tenantName, customerId, createdEvent, id, notifyVars);
      } catch {
        /* SMS must not roll back a saved service */
      }
    }

    return {
      customer_id: customerId,
      service_id: id,
      invoice_id: invoiceId,
      account_number: serviceAccountNumber,
      customer_account_number: customerAccountNumber,
      username: live?.username || username,
      password: afterPay ? null : password,
      static_ip: live?.static_ip || null,
      status: live?.status || insertStatus,
      activation: service.activation,
      provision_overall: provisionOverall,
      partial_error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not create the service";
    if (createdServiceId) {
      const [live] = await sql<{
        status: string;
        username: string | null;
        static_ip: string | null;
        account_number: string;
      }>`select status, username, static_ip, coalesce(account_number,'') as account_number
         from services where id = ${createdServiceId} and tenant_id = ${tid}`;
      return {
        customer_id: customerId,
        service_id: createdServiceId,
        invoice_id: null,
        account_number: live?.account_number || customerAccountNumber,
        customer_account_number: customerAccountNumber,
        username: live?.username || null,
        password: null,
        static_ip: live?.static_ip || null,
        status: live?.status || null,
        activation: service.activation,
        provision_overall: null,
        partial_error: msg,
      };
    }
    if (createdCustomer) {
      return {
        customer_id: customerId,
        service_id: null,
        invoice_id: null,
        account_number: customerAccountNumber,
        customer_account_number: customerAccountNumber,
        username: null,
        password: null,
        static_ip: null,
        status: null,
        activation: null,
        provision_overall: null,
        partial_error: `Customer saved. Service failed: ${msg}`,
      };
    }
    throw err;
  }
}

export function assertNoSecrets(details: string) {
  return !/password|secret|token|key/i.test(details);
}
