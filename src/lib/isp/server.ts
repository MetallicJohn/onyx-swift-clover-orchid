import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { nid } from "@/lib/utils";
import {
  ensureDefaultTemplates,
  notifyCustomerEvent,
  runBillingCycle,
} from "./notifications";
import { provisionServiceAccess, seedOpsForTenant } from "./access";
import { allocateStaticIp, disconnectSession, rotateServicePassword } from "./access-service";
import { getProvisioning, listProvisioning, rotatePppoeCredentials, startPppoeProvision } from "./pppoe-provision";
import { issueInvoice } from "./billing";
import { nairobiDate } from "./empty-tenant";
import { loadChurnScores } from "./churn";
import { loadDashboard } from "./dashboard";
import { requestPublicOrigin } from "./auth-origins";
import { completeOperatorReset, requestOperatorReset } from "./password-reset";
import { agentPullUrl, agentScript, enrollFields, enqueueAgentCommand, enqueuePackageProfiles, nextWgAddress } from "./agent";
import { mikrotikProfileName } from "./pcq";
import { mikrotikRateLimit } from "./radius-format";
import { wgEnrollContext } from "./wireguard";
import { emit } from "./events";
import { listInbox } from "./inbox";
import { applyConfirmedPayment } from "./payments";
import { consumeActiveGrantsForService, getGracePolicy } from "./grace";
import { groupAssignments, listTags, loadAssignments, setCustomerTags } from "./tags";
import { assertPermission } from "./rbac";
import { assertCustomerQuota, assertRouterQuota, assertTenantOperable } from "./saas";
import { assertFeature, featureForAccess } from "./plans";
import {
  isHotspotDurationUnit,
  validityHoursFromDuration,
} from "./hotspot-duration";
import { ensureServiceAccountNumber } from "./account-numbers";
import { allocateCustomerId } from "./customer-ids";
import { applyRls } from "./rls";
import { loadAuthUser, provisionTenant, setCredentialPassword, changeOwnPassword, isPlatformAdmin } from "./accounts";
import { resolveActiveTenant, setActiveTenant } from "./tenant-context";
import { openTicket } from "./tickets";
import type {
  AccessMethod,
  CustomerRow,
  DashboardData,
  InvoiceRow,
  PackageRow,
  PaymentRow,
  ServiceRow,
  ServiceStatus,
  TicketRow,
  Workspace,
} from "./types";

type Sql = Awaited<ReturnType<typeof getSql>>;

function normalizePackageCredit(data: {
  tier?: string;
  business_credit_enabled?: boolean;
  max_credit_kes?: number;
  credit_warning_kes?: number;
  disconnect_when_credit_reached?: boolean;
  allow_service_continuity_after_expiry?: boolean;
  send_credit_limit_warning?: boolean;
  credit_days_limit?: number;
  credit_terms_notes?: string;
}) {
  const tier = data.tier === "business" || data.tier === "enterprise" ? data.tier : "residential";
  const enabled = Boolean(data.business_credit_enabled) && tier !== "residential";
  return {
    tier,
    enabled,
    maxKes: Math.max(0, Math.round(data.max_credit_kes ?? 0)),
    warningKes: Math.max(0, Math.round(data.credit_warning_kes ?? 0)),
    disconnect: data.disconnect_when_credit_reached !== false,
    continuity: data.allow_service_continuity_after_expiry !== false,
    sendWarning: data.send_credit_limit_warning !== false,
    daysLimit: Math.max(0, Math.round(data.credit_days_limit ?? 0)),
    notes: String(data.credit_terms_notes || "").slice(0, 500),
  };
}

function packageDurationFields(data: {
  access_method: AccessMethod;
  billing_interval: string;
  grace_days: number;
  validity_hours?: number;
  duration_value?: number;
  duration_unit?: string;
  tier?: string;
  business_credit_enabled?: boolean;
  max_credit_kes?: number;
  credit_warning_kes?: number;
  disconnect_when_credit_reached?: boolean;
  allow_service_continuity_after_expiry?: boolean;
  send_credit_limit_warning?: boolean;
  credit_days_limit?: number;
  credit_terms_notes?: string;
}) {
  if (data.access_method === "hotspot") {
    const unit = isHotspotDurationUnit(data.duration_unit) ? data.duration_unit : "hours";
    const value = Math.max(1, Math.trunc(Number(data.duration_value) || 0));
    if (!(value >= 1)) throw new Error("Duration is required");
    return {
      billing_interval: data.billing_interval || "daily",
      grace_days: 0,
      validity_hours: validityHoursFromDuration(value, unit),
      duration_value: value,
      duration_unit: unit,
      credit: normalizePackageCredit({
        tier: "residential",
        business_credit_enabled: false,
        max_credit_kes: 0,
        credit_warning_kes: 0,
        disconnect_when_credit_reached: true,
        allow_service_continuity_after_expiry: false,
        send_credit_limit_warning: false,
        credit_days_limit: 0,
        credit_terms_notes: "",
      }),
    };
  }
  return {
    billing_interval: data.billing_interval,
    grace_days: data.grace_days,
    validity_hours: Math.max(0, data.validity_hours ?? 0),
    duration_value: Math.max(0, Math.trunc(Number(data.duration_value) || 0)),
    duration_unit: isHotspotDurationUnit(data.duration_unit) ? data.duration_unit : "hours",
    credit: normalizePackageCredit(data),
  };
}

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

async function ensureWorkspace(
  sql: Sql,
  userId: string,
  displayName: string | null,
  email: string | null,
  ispName?: string | null,
  phone?: string | null,
): Promise<Workspace> {
  await applyRls(sql, { bypass: true });
  const profile = await loadAuthUser(sql, userId);
  const person = displayName || profile?.name || null;
  const mail = email || profile?.email || null;
  const active = await resolveActiveTenant(sql, userId);
  if (!active) {
    if (await isPlatformAdmin(sql, userId)) {
      const err = new Error("No ISP workspace. Open SaaS Management.");
      (err as Error & { code?: string }).code = "PLATFORM_ONLY";
      throw err;
    }
  }
  const workspace =
    active ??
    (await provisionTenant(sql, userId, { ispName, personName: person, email: mail, phone }));

  await applyRls(sql, { tenantId: workspace.tenantId, bypass: false });
  await ensureDefaultTemplates(sql, workspace.tenantId);
  await seedOpsForTenant(sql, workspace.tenantId);
  return workspace;
}

async function requireTenant(
  userId: string,
  displayName?: string | null,
  email?: string | null,
  ispName?: string | null,
  phone?: string | null,
) {
  const sql = await getSql();
  const workspace = await ensureWorkspace(sql, userId, displayName ?? null, email ?? null, ispName, phone);
  return { sql, workspace };
}

export const bootstrapWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { isp_name?: string; phone?: string }) => d)
  .handler(async ({ context, data }) => {
    const { assertSignupPhone } = await import("./trial-claims");
    const phone = data.phone ? assertSignupPhone(data.phone) : "";
    if (!phone) throw new Error("Enter a mobile number. One free trial is allowed per email or phone.");
    const { workspace } = await requireTenant(context.userId, null, null, data.isp_name, phone);
    return workspace;
  });

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    let origin = "http://localhost:8080";
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      origin = requestPublicOrigin(getRequest() ?? null, origin);
    } catch {
      /* unit tests have no request */
    }
    return requestOperatorReset(sql, data.email, origin);
  });

export const completePasswordReset = createServerFn({ method: "POST" })
  .validator((d: { token: string; password: string }) => d)
  .handler(async ({ data }) => completeOperatorReset(await getSql(), data.token, data.password));

export const setStaffPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { user_id: string; password: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "settings.manage");
    const [mem] = await sql<{ email: string }>`
      select u.email from tenant_members m
      join "user" u on u.id = m.user_id
      where m.tenant_id = ${workspace.tenantId} and m.user_id = ${data.user_id}`;
    if (!mem?.email) throw new Error("Not a member of this ISP");
    await setCredentialPassword(sql, mem.email, data.password);
    await audit(sql, workspace.tenantId, context.userId, "staff.password_reset", "user", data.user_id);
    return { ok: true };
  });

export const setCustomerPortalPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; password: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "customers.manage");
    const { setPortalPassword } = await import("./portal");
    await setPortalPassword(sql, workspace.tenantId, data.customer_id, data.password);
    await audit(sql, workspace.tenantId, context.userId, "customer.portal_password", "customer", data.customer_id);
    return { ok: true };
  });

export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { current: string; password: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    return changeOwnPassword(sql, context.userId, data.current, data.password);
  });


export const listMyTenants = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const { listMemberships } = await import("./tenant-context");
    const rows = await listMemberships(sql, context.userId);
    const active = await resolveActiveTenant(sql, context.userId);
    return {
      activeId: active?.tenantId ?? "",
      tenants: rows.map((r) => ({ id: r.tenant_id, name: r.name, role: r.role })),
    };
  });

export const switchTenant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const ws = await setActiveTenant(sql, context.userId, data.tenant_id);
    await audit(sql, ws.tenantId, context.userId, "tenant.switched", "tenant", ws.tenantId);
    return ws;
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DashboardData> => {
    const { sql, workspace } = await requireTenant(context.userId);
    return loadDashboard(sql, workspace);
  });

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "customers.read");
    const rows = await sql<CustomerRow>`
      select c.id, c.type, c.name, c.phone, c.email, c.address, c.status, coalesce(c.account_number,'') as account_number, coalesce(c.notes,'') as notes, c.created_at::text as created_at,
        (select count(*)::int from services s where s.customer_id = c.id and s.deleted_at is null) as service_count,
        (select coalesce(sum(greatest(0, i.amount_kes - i.paid_kes)),0)::int from invoices i where i.customer_id = c.id and i.status in ('due','overdue','issued','partial')) as balance_kes
      from customers c
      where c.tenant_id = ${workspace.tenantId} and c.deleted_at is null
      order by c.created_at desc`;
    const churn = await loadChurnScores(sql, workspace.tenantId);
    const byId = new Map(churn.map((c) => [c.customerId, c]));
    const tagRows = await loadAssignments(sql, workspace.tenantId);
    const tagsByCustomer = groupAssignments(tagRows);
    const catalog = await listTags(sql, workspace.tenantId);
    const services = await sql<{
      customer_id: string;
      access_method: string;
      status: string;
      period_end: string | null;
      package_name: string;
    }>`
      select s.customer_id, s.access_method, s.status, s.period_end::text as period_end, p.name as package_name
      from services s
      join packages p on p.id = s.package_id
      where s.tenant_id = ${workspace.tenantId} and s.deleted_at is null`;
    const svcByCustomer = new Map<string, typeof services>();
    for (const s of services) {
      const list = svcByCustomer.get(s.customer_id) ?? [];
      list.push(s);
      svcByCustomer.set(s.customer_id, list);
    }
    const customers = rows.map((r) => {
      const hit = byId.get(r.id);
      const lines = svcByCustomer.get(r.id) ?? [];
      const now = Date.now();
      let line_status: CustomerRow["line_status"] = "none";
      if (lines.some((s) => s.status === "active" || s.status === "grace")) line_status = "active";
      else if (lines.some((s) => s.period_end && Date.parse(s.period_end) < now)) line_status = "expired";
      else if (lines.some((s) => s.status === "suspended") || r.status === "suspended") line_status = "suspended";
      return {
        ...r,
        churn_score: hit?.score ?? 0,
        churn_band: hit?.band ?? "low",
        churn_reason: hit?.reasons[0] ?? "",
        tags: tagsByCustomer.get(r.id) ?? [],
        access_methods: [...new Set(lines.map((s) => s.access_method))],
        package_names: [...new Set(lines.map((s) => s.package_name))],
        line_status,
      };
    });
    const packages = [...new Set(services.map((s) => s.package_name))].sort();
    return { workspace, customers, tags: catalog, packages };
  });

export const createCustomer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string; phone: string; email: string; address: string; type: string; portal_password?: string; tag_ids?: string[]; account_number?: string; notes?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "customers.manage");
    const name = data.name.trim();
    if (!name) throw new Error("Name is required");
    const notes = (data.notes || "").trim().slice(0, 4000);
    await assertCustomerQuota(sql, workspace.tenantId);
    const { assertUniqueCustomerPhone, ensureInitialPortalPassword, setPortalPassword } = await import("./portal");
    await assertUniqueCustomerPhone(sql, workspace.tenantId, data.phone);
    const id = nid("cus");
    const accountNumber = await allocateCustomerId(sql, workspace.tenantId);
    try {
      await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status, account_number, notes)
        values (${id}, ${workspace.tenantId}, ${data.type || "individual"}, ${name}, ${data.phone.trim()}, ${data.email.trim()}, ${data.address.trim()}, 'active', ${accountNumber}, ${notes})`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/account_number|unique/i.test(msg)) throw new Error("ID already assigned.");
      throw err;
    }
    if (data.portal_password) {
      await setPortalPassword(sql, workspace.tenantId, id, data.portal_password);
    } else {
      await ensureInitialPortalPassword(sql, workspace.tenantId, id, data.phone);
    }
    if (data.tag_ids?.length) await setCustomerTags(sql, workspace.tenantId, id, data.tag_ids);
    await emit(sql, {
      type: "customer.created",
      tenantId: workspace.tenantId,
      payload: { customer_id: id, phone: data.phone, name },
    });
    await audit(sql, workspace.tenantId, context.userId, "customer.created", "customer", id);
    return { id };
  });

export const updateCustomer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; name: string; phone: string; email: string; address: string; type: string; tag_ids?: string[]; account_number?: string; notes?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "customers.manage");
    const name = data.name.trim();
    if (!name) throw new Error("Name is required");
    const { assertUniqueCustomerPhone } = await import("./portal");
    await assertUniqueCustomerPhone(sql, workspace.tenantId, data.phone, data.id);
    const notes = (data.notes ?? "").trim().slice(0, 4000);
    const rows = await sql<{ id: string; account_number: string }>`
      update customers
      set name = ${name}, phone = ${data.phone.trim()}, email = ${data.email.trim()}, address = ${data.address.trim()}, type = ${data.type || "individual"}, notes = ${notes}
      where id = ${data.id} and tenant_id = ${workspace.tenantId} and deleted_at is null
      returning id, coalesce(account_number,'') as account_number`;
    if (!rows[0]) throw new Error("Customer not found");
    if (data.tag_ids) await setCustomerTags(sql, workspace.tenantId, data.id, data.tag_ids);
    await audit(sql, workspace.tenantId, context.userId, "customer.updated", "customer", data.id);
    return { id: data.id };
  });

export const listPackages = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "packages.read");
    const packages = await sql<PackageRow>`
      select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours,
             coalesce(duration_value,0)::int as duration_value, coalesce(duration_unit,'hours') as duration_unit, active,
             coalesce(tier,'residential') as tier, business_credit_enabled, coalesce(max_credit_kes,0)::int as max_credit_kes,
             coalesce(credit_warning_kes,0)::int as credit_warning_kes, disconnect_when_credit_reached,
             allow_service_continuity_after_expiry, send_credit_limit_warning, coalesce(credit_days_limit,0)::int as credit_days_limit,
             coalesce(credit_terms_notes,'') as credit_terms_notes
      from packages where tenant_id = ${workspace.tenantId} order by price_kes`;
    return { workspace, packages };
  });

export const createPackage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: {
    name: string;
    description: string;
    access_method: AccessMethod;
    download_mbps: number;
    upload_mbps: number;
    price_kes: number;
    billing_interval: string;
    grace_days: number;
    bundle_mb?: number;
    validity_hours?: number;
    duration_value?: number;
    duration_unit?: string;
    active?: boolean;
    tier?: string;
    business_credit_enabled?: boolean;
    max_credit_kes?: number;
    credit_warning_kes?: number;
    disconnect_when_credit_reached?: boolean;
    allow_service_continuity_after_expiry?: boolean;
    send_credit_limit_warning?: boolean;
    credit_days_limit?: number;
    credit_terms_notes?: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "packages.manage");
    if (!data.name.trim()) throw new Error("Name is required");
    if (!["pppoe", "static", "hotspot"].includes(data.access_method)) {
      throw new Error("Access method must be PPPoE, static, or hotspot");
    }
    await assertTenantOperable(sql, workspace.tenantId);
    await assertFeature(sql, workspace.tenantId, featureForAccess(data.access_method));
    const id = nid("pkg");
    const fields = packageDurationFields(data);
    const active = data.active !== false;
    await sql`insert into packages (id, tenant_id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, duration_value, duration_unit, active,
        tier, business_credit_enabled, max_credit_kes, credit_warning_kes, disconnect_when_credit_reached, allow_service_continuity_after_expiry, send_credit_limit_warning, credit_days_limit, credit_terms_notes)
      values (${id}, ${workspace.tenantId}, ${data.name.trim()}, ${data.description}, ${data.access_method}, ${data.download_mbps}, ${data.upload_mbps}, ${data.price_kes}, ${fields.billing_interval}, ${fields.grace_days}, ${Math.max(0, data.bundle_mb ?? 0)}, ${fields.validity_hours}, ${fields.duration_value}, ${fields.duration_unit}, ${active},
        ${fields.credit.tier}, ${fields.credit.enabled}, ${fields.credit.maxKes}, ${fields.credit.warningKes}, ${fields.credit.disconnect}, ${fields.credit.continuity}, ${fields.credit.sendWarning}, ${fields.credit.daysLimit}, ${fields.credit.notes})`;
    await enqueuePackageProfiles(sql, workspace.tenantId, {
      name: data.name.trim(),
      download_mbps: data.download_mbps,
      upload_mbps: data.upload_mbps,
      access_method: data.access_method,
    });
    await audit(sql, workspace.tenantId, context.userId, "package.created", "package", id);
    return { id };
  });

export const updatePackage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: {
    id: string;
    name: string;
    description: string;
    access_method: AccessMethod;
    download_mbps: number;
    upload_mbps: number;
    price_kes: number;
    billing_interval: string;
    grace_days: number;
    bundle_mb?: number;
    validity_hours?: number;
    duration_value?: number;
    duration_unit?: string;
    active: boolean;
    tier?: string;
    business_credit_enabled?: boolean;
    max_credit_kes?: number;
    credit_warning_kes?: number;
    disconnect_when_credit_reached?: boolean;
    allow_service_continuity_after_expiry?: boolean;
    send_credit_limit_warning?: boolean;
    credit_days_limit?: number;
    credit_terms_notes?: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "packages.manage");
    if (!data.name.trim()) throw new Error("Name is required");
    if (!["pppoe", "static", "hotspot"].includes(data.access_method)) {
      throw new Error("Access method must be PPPoE, static, or hotspot");
    }
    const fields = packageDurationFields(data);
    const rows = await sql<{ id: string }>`
      update packages
      set name = ${data.name.trim()},
          description = ${data.description},
          access_method = ${data.access_method},
          download_mbps = ${data.download_mbps},
          upload_mbps = ${data.upload_mbps},
          price_kes = ${data.price_kes},
          billing_interval = ${fields.billing_interval},
          grace_days = ${fields.grace_days},
          bundle_mb = ${Math.max(0, data.bundle_mb ?? 0)},
          validity_hours = ${fields.validity_hours},
          duration_value = ${fields.duration_value},
          duration_unit = ${fields.duration_unit},
          active = ${data.active},
          tier = ${fields.credit.tier},
          business_credit_enabled = ${fields.credit.enabled},
          max_credit_kes = ${fields.credit.maxKes},
          credit_warning_kes = ${fields.credit.warningKes},
          disconnect_when_credit_reached = ${fields.credit.disconnect},
          allow_service_continuity_after_expiry = ${fields.credit.continuity},
          send_credit_limit_warning = ${fields.credit.sendWarning},
          credit_days_limit = ${fields.credit.daysLimit},
          credit_terms_notes = ${fields.credit.notes}
      where id = ${data.id} and tenant_id = ${workspace.tenantId}
      returning id`;
    if (!rows[0]) throw new Error("Package not found");
    const profile = mikrotikProfileName(data.name.trim());
    const rate = mikrotikRateLimit(data.download_mbps, data.upload_mbps);
    await sql`update radius_accounts
      set group_name = ${profile}, rate_limit = ${rate}
      where tenant_id = ${workspace.tenantId}
        and service_id in (select id from services where package_id = ${data.id} and tenant_id = ${workspace.tenantId})`;
    await enqueuePackageProfiles(sql, workspace.tenantId, {
      name: data.name.trim(),
      download_mbps: data.download_mbps,
      upload_mbps: data.upload_mbps,
      access_method: data.access_method,
    });
    const live = await sql<{ username: string; framed_ip: string; router_id: string | null; service_id: string }>`
      select p.username, p.framed_ip, p.router_id, s.id as service_id
      from service_provisioning p join services s on s.id = p.service_id
      where p.tenant_id = ${workspace.tenantId} and s.package_id = ${data.id} and p.framed_ip <> ''`;
    for (const row of live) {
      await enqueueAgentCommand(
        sql,
        workspace.tenantId,
        "queue.upsert",
        {
          username: row.username,
          static_ip: row.framed_ip,
          qname: `pppoe-${row.username}`.slice(0, 32),
          download_mbps: data.download_mbps,
          upload_mbps: data.upload_mbps,
          package: data.name.trim(),
          service_id: row.service_id,
        },
        row.router_id,
      );
    }
    await audit(sql, workspace.tenantId, context.userId, "package.updated", "package", data.id);
    return { id: data.id };
  });

export const listServices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.read");
    const services = await sql<ServiceRow>`
      select s.id, s.customer_id, c.name as customer_name, c.phone as customer_phone,
             coalesce(s.account_number, '') as account_number,
             coalesce(c.account_number, '') as customer_account_number,
             coalesce(nullif(s.name,''), p.name) as name,
             s.package_id, p.name as package_name,
             s.access_method, s.username, s.static_ip, coalesce(s.mac_address, '') as mac_address,
             s.status, s.created_at::text as created_at,
             s.period_end::text as period_end, s.access_until::text as access_until, s.expiry_source,
             s.expiry_change_reason, s.bundle_used_mb, p.bundle_mb, s.suspend_reason,
             coalesce(s.notes,'') as notes,
             (g.id is not null) as grace_active, g.days_granted as grace_days_granted,
             g.starts_at::text as grace_starts_at, g.expires_at::text as grace_expires_at,
             g.granted_by_label as grace_granted_by, g.reason as grace_reason, p.grace_days as package_grace_days
      from services s
      join customers c on c.id = s.customer_id
      join packages p on p.id = s.package_id
      left join service_grace_periods g
        on g.service_id = s.id and s.tenant_id = g.tenant_id and g.status = 'active'
      where s.tenant_id = ${workspace.tenantId} and c.deleted_at is null and s.deleted_at is null
      order by s.created_at desc`;
    const customers = await sql<{ id: string; name: string }>`select id, name from customers where tenant_id = ${workspace.tenantId} and deleted_at is null order by name`;
    const packages = await sql<PackageRow>`
      select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active
      from packages where tenant_id = ${workspace.tenantId} and active = true`;
    const gracePolicy = await getGracePolicy(sql, workspace.tenantId);
    const provisioning = await listProvisioning(sql, workspace.tenantId);
    const byService = new Map(provisioning.map((p) => [p.service_id, p]));
    const devices = await sql<{ id: string; serial: string; customer_id: string | null; status: string; last_inform: string | null }>`
      select id, serial, customer_id, status, last_inform::text as last_inform from cpe_devices
      where tenant_id = ${workspace.tenantId} order by serial`;
    return {
      workspace,
      services: services.map((s) => ({ ...s, provision: byService.get(s.id) || null })),
      customers,
      packages,
      gracePolicy,
      devices,
    };
  });

export const createService = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: {
    customer_id: string;
    package_id: string;
    username?: string;
    static_ip?: string;
    cpe_id?: string;
    notes?: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.manage");
    const tid = workspace.tenantId;
    const [pkg] = await sql<{
      name: string;
      access_method: AccessMethod;
      price_kes: number;
      billing_interval: string;
      validity_hours: number;
    }>`select name, access_method, price_kes, billing_interval, validity_hours
       from packages where id = ${data.package_id} and tenant_id = ${tid}`;
    if (!pkg) throw new Error("Package not found");
    await assertFeature(sql, tid, featureForAccess(pkg.access_method));
    const [cus] = await sql<{ id: string }>`select id from customers where id = ${data.customer_id} and tenant_id = ${tid} and deleted_at is null`;
    if (!cus) throw new Error("Customer not found");
    const id = nid("svc");
    const { periodMs } = await import("./access-policy");
    const periodEnd = new Date(Date.now() + periodMs(pkg.billing_interval, pkg.validity_hours)).toISOString();
    const initialStatus = pkg.access_method === "pppoe" ? "pending" : "active";
    const notes = (data.notes || "").trim().slice(0, 4000);
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end, notes, name)
      values (${id}, ${tid}, ${data.customer_id}, ${data.package_id}, ${pkg.access_method}, ${data.username || null}, ${data.static_ip || null}, ${initialStatus}, ${periodEnd}, ${notes}, ${pkg.name})`;
    const serviceAccount = await ensureServiceAccountNumber(sql, tid, id);
    if (pkg.access_method === "static" && !data.static_ip) {
      await allocateStaticIp(sql, tid, id, data.customer_id);
    }
    let radius: { username?: string; password?: string } | null = null;
    let provision = null;
    if (pkg.access_method === "pppoe") {
      provision = await startPppoeProvision(sql, tid, {
        serviceId: id,
        cpeId: data.cpe_id || null,
        manualUsername: data.username,
      });
      radius = { username: provision.username, password: provision.password };
      await audit(sql, tid, context.userId, "service.pppoe.provision", "service", id, JSON.stringify({ username: provision.username, cpe_id: data.cpe_id || "" }));
    } else {
      radius = await provisionServiceAccess(sql, tid, id);
    }
    const unpaid = await sql<{ id: string }>`
      select i.id from invoices i
      where i.tenant_id = ${tid} and i.customer_id = ${data.customer_id}
        and i.status in ('issued','due','overdue','partial')
        and (
          i.service_id = ${id}
          or exists (
            select 1 from invoice_items ii
            where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${id}
          )
        )
      limit 1`;
    if (!unpaid[0] && pkg.price_kes > 0) {
      const dueDate = nairobiDate(periodEnd);
      const inv = await issueInvoice(sql, {
        tenantId: tid,
        customerId: data.customer_id,
        serviceId: id,
        dueDate,
        items: [
          {
            description: `${pkg.name} (${pkg.billing_interval})`,
            quantity: 1,
            unit_kes: pkg.price_kes,
            package_id: data.package_id,
            service_id: id,
          },
        ],
      });
      await notifyCustomerEvent(sql, tid, workspace.tenantName, data.customer_id, "invoice.created", inv.id, {
        customer_name: "",
        invoice_number: inv.number,
        amount: `KES ${inv.amount_kes}`,
        due_date: dueDate,
      });
    }
    await audit(sql, tid, context.userId, "service.created", "service", id, JSON.stringify({ account_number: serviceAccount }));
    return { id, username: radius?.username, password: radius?.password, provision, account_number: serviceAccount };
  });

export const setServiceStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; status: ServiceStatus }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.manage");
    if (data.status === "active") {
      const [row] = await sql<{ customer_id: string }>`
        select customer_id from services where id = ${data.id} and tenant_id = ${workspace.tenantId} and deleted_at is null`;
      if (row) {
        const { grantPaidPeriod } = await import("./access-policy");
        await grantPaidPeriod(sql, workspace.tenantId, row.customer_id, new Date(), data.id);
        await consumeActiveGrantsForService(sql, workspace.tenantId, data.id);
      }
    }
    const reason = data.status === "suspended" ? "manual" : data.status === "active" ? "" : "invoice";
    await sql`update services set status = ${data.status}, suspend_reason = ${reason}
      where id = ${data.id} and tenant_id = ${workspace.tenantId} and deleted_at is null`;
    const [svc] = await sql<{ customer_id: string; name: string }>`
      select s.customer_id, p.name from services s join packages p on p.id = s.package_id
      where s.id = ${data.id} and s.tenant_id = ${workspace.tenantId} and s.deleted_at is null`;
    if (svc && data.status === "suspended") {
      await notifyCustomerEvent(sql, workspace.tenantId, workspace.tenantName, svc.customer_id, "service.suspended", data.id, {
        customer_name: "",
        service_name: svc.name,
      });
    }
    if (svc && data.status === "active") {
      await notifyCustomerEvent(sql, workspace.tenantId, workspace.tenantName, svc.customer_id, "service.restored", data.id, {
        customer_name: "",
        service_name: svc.name,
      });
    }
    if (svc && data.status === "grace") {
      await notifyCustomerEvent(sql, workspace.tenantId, workspace.tenantName, svc.customer_id, "grace.started", data.id, {
        customer_name: "",
        service_name: svc.name,
      });
    }
    await provisionServiceAccess(sql, workspace.tenantId, data.id);
    await audit(sql, workspace.tenantId, context.userId, `service.${data.status}`, "service", data.id);
    return { ok: true };
  });

export const rotateServiceSecret = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; confirm?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.manage");
    if (!data.confirm) throw new Error("Confirm credential rotation");
    const [svc] = await sql<{ access_method: string }>`
      select access_method from services where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
    if (!svc) throw new Error("Service not found");
    if (svc.access_method === "pppoe") {
      const out = await rotatePppoeCredentials(sql, workspace.tenantId, data.id);
      await audit(sql, workspace.tenantId, context.userId, "service.password.rotate", "service", data.id, out.username);
      return { username: out.username, password: out.password, hint: out.password_hint };
    }
    const out = await rotateServicePassword(sql, workspace.tenantId, data.id);
    await audit(sql, workspace.tenantId, context.userId, "service.password", "service", data.id);
    return out;
  });

export const retryPppoeProvisionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; cpe_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.manage");
    const out = await startPppoeProvision(sql, workspace.tenantId, { serviceId: data.id, cpeId: data.cpe_id, rotate: false });
    await audit(sql, workspace.tenantId, context.userId, "service.pppoe.retry", "service", data.id);
    return { ...out, password: "" };
  });

export const getPppoeProvisionFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.read");
    return getProvisioning(sql, workspace.tenantId, data.id);
  });

export const revealPppoePasswordFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.manage");
    const [row] = await sql<{ username: string; password: string }>`
      select username, password from radius_accounts
      where tenant_id = ${workspace.tenantId} and service_id = ${data.id}`;
    if (!row) throw new Error("RADIUS account not found");
    const { revealRadiusPassword } = await import("./pppoe-credentials");
    await audit(sql, workspace.tenantId, context.userId, "service.password.reveal", "service", data.id, row.username);
    return { username: row.username, password: revealRadiusPassword(row.password) };
  });

export const disconnectService = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.manage");
    const out = await disconnectSession(sql, workspace.tenantId, data.id);
    await audit(sql, workspace.tenantId, context.userId, "service.disconnect", "service", data.id);
    return out;
  });

export const listBilling = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "invoices.read");
    const tid = workspace.tenantId;
    const invoices = await sql<InvoiceRow>`
      select i.id, i.customer_id, c.name as customer_name, i.number, i.amount_kes,
             i.subtotal_kes, i.tax_kes, i.tax_rate, i.paid_kes,
             case when i.status = 'paid' then 0 else greatest(0, i.amount_kes - i.paid_kes) end as remaining_kes,
             i.status, i.due_date::text as due_date, i.issued_at::text as issued_at, i.notes,
             coalesce(i.service_id, '') as service_id,
             coalesce(s.account_number, '') as service_account,
             coalesce(nullif(s.name, ''), p.name, '') as service_name
      from invoices i
      join customers c on c.id = i.customer_id
      left join services s on s.id = i.service_id and s.tenant_id = i.tenant_id
      left join packages p on p.id = s.package_id
      where i.tenant_id = ${tid}
      order by i.issued_at desc`;
    const payments = await sql<PaymentRow>`
      select p.id, p.customer_id, c.name as customer_name, p.invoice_id, p.provider, p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at,
             coalesce(p.service_id, '') as service_id
      from payments p join customers c on c.id = p.customer_id
      where p.tenant_id = ${tid}
      order by p.paid_at desc`;
    const customers = await sql<{ id: string; name: string; phone: string; account_number: string }>`
      select id, name, phone, coalesce(account_number, '') as account_number
      from customers where tenant_id = ${tid} and deleted_at is null order by name`;
    const quotes = await sql<{
      customer_id: string;
      package_id: string;
      service_id: string;
      package_name: string;
      price_kes: number;
      billing_interval: string;
      account_number: string;
      service_name: string;
    }>`
      select s.customer_id, p.id as package_id, s.id as service_id, p.name as package_name, p.price_kes, p.billing_interval,
             coalesce(s.account_number, '') as account_number, coalesce(s.name, '') as service_name
      from services s join packages p on p.id = s.package_id
      where s.tenant_id = ${tid} and s.deleted_at is null and s.status in ('active','grace','suspended','pending')
      order by p.price_kes`;
    const [ten] = await sql<{ vat_enabled: boolean; vat_rate_pct: number }>`
      select vat_enabled, vat_rate_pct from tenants where id = ${tid}`;
    const { tallyAging } = await import("./aging");
    const aging = tallyAging(invoices);
    const outstanding = invoices.reduce((s, i) => s + i.remaining_kes, 0);
    const overdue = invoices
      .filter((i) => i.status === "overdue" || (i.status === "partial" && i.remaining_kes > 0 && i.due_date < new Date().toISOString().slice(0, 10)))
      .reduce((s, i) => s + i.remaining_kes, 0);
    const collected = payments.filter((p) => p.status === "confirmed").reduce((s, p) => s + p.amount_kes, 0);
    const open = invoices.filter((i) => i.remaining_kes > 0).length;
    return {
      workspace,
      invoices,
      payments,
      customers,
      quotes,
      vat_enabled: Boolean(ten?.vat_enabled),
      vat_rate_pct: ten?.vat_rate_pct ?? 16,
      aging,
      totals: { outstanding, overdue, collected, open },
    };
  });

export const getInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "invoices.read");
    const tid = workspace.tenantId;
    const [invoice] = await sql<InvoiceRow & { notes: string }>`
      select i.id, i.customer_id, c.name as customer_name, i.number, i.amount_kes,
             i.subtotal_kes, i.tax_kes, i.tax_rate, i.paid_kes,
             case when i.status = 'paid' then 0 else greatest(0, i.amount_kes - i.paid_kes) end as remaining_kes,
             i.status, i.due_date::text as due_date, i.issued_at::text as issued_at, i.notes
      from invoices i join customers c on c.id = i.customer_id
      where i.id = ${data.id} and i.tenant_id = ${tid}`;
    if (!invoice) throw new Error("Invoice not found");
    const [customer] = await sql<{
      id: string;
      name: string;
      phone: string;
      email: string;
      address: string;
    }>`select id, name, phone, email, address from customers where id = ${invoice.customer_id} and tenant_id = ${tid}`;
    const items = await sql<{
      id: string;
      description: string;
      quantity: number;
      unit_kes: number;
      amount_kes: number;
    }>`select id, description, quantity, unit_kes, amount_kes from invoice_items
       where invoice_id = ${invoice.id} and tenant_id = ${tid} order by description`;
    const payments = await sql<PaymentRow>`
      select p.id, p.customer_id, c.name as customer_name, p.invoice_id, p.provider, p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at
      from payments p join customers c on c.id = p.customer_id
      where p.invoice_id = ${invoice.id} and p.tenant_id = ${tid}
      order by p.paid_at desc`;
    const allocations = await sql<{ id: string; payment_id: string; amount_kes: number }>`
      select id, payment_id, amount_kes from payment_allocations where invoice_id = ${invoice.id} and tenant_id = ${tid}`;
    return {
      invoice,
      customer,
      items,
      payments,
      allocations,
      tenant: {
        name: workspace.tenantName,
        supportEmail: workspace.supportEmail,
        supportPhone: workspace.supportPhone,
      },
    };
  });

export const saveBillingSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { vat_enabled: boolean; vat_rate_pct?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "invoices.manage");
    const rate = Math.min(100, Math.max(0, Math.round(data.vat_rate_pct ?? 16)));
    await sql`update tenants set vat_enabled = ${data.vat_enabled}, vat_rate_pct = ${rate} where id = ${workspace.tenantId}`;
    await audit(sql, workspace.tenantId, context.userId, "billing.settings", "tenant", workspace.tenantId);
    return { vat_enabled: data.vat_enabled, vat_rate_pct: rate };
  });

export const createInvoice = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      customer_id: string;
      due_date: string;
      amount_kes?: number;
      notes?: string;
      items?: Array<{
        description: string;
        quantity?: number;
        unit_kes: number;
        package_id?: string;
        service_id?: string;
      }>;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    const tid = workspace.tenantId;
    assertPermission(workspace.role, "invoices.manage");
    const [cus] = await sql<{ id: string }>`select id from customers where id = ${data.customer_id} and tenant_id = ${tid} and deleted_at is null`;
    if (!cus) throw new Error("Customer not found");
    const inv = await issueInvoice(sql, {
      tenantId: tid,
      customerId: data.customer_id,
      dueDate: data.due_date,
      amountKes: data.amount_kes,
      items: data.items,
      notes: data.notes,
    });
    await notifyCustomerEvent(sql, tid, workspace.tenantName, data.customer_id, "invoice.created", inv.id, {
      customer_name: "",
      invoice_number: inv.number,
      amount: `KES ${inv.amount_kes}`,
      due_date: data.due_date,
    });
    await audit(sql, tid, context.userId, "invoice.created", "invoice", inv.id);
    return inv;
  });

export const recordPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { invoice_id: string; provider: string; reference: string; amount_kes?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    const tid = workspace.tenantId;
    assertPermission(workspace.role, "payments.manage");
    const [inv] = await sql<{ id: string }>`
      select id from invoices where id = ${data.invoice_id} and tenant_id = ${tid}`;
    if (!inv) throw new Error("Invoice not found");
    const result = await applyConfirmedPayment(sql, {
      tenantId: tid,
      ispName: workspace.tenantName,
      invoiceId: inv.id,
      provider: data.provider || "mpesa",
      reference: data.reference.trim() || `MPESA-${Date.now()}`,
      amountKes: data.amount_kes,
    });
    await audit(sql, tid, context.userId, "payment.received", "payment", result.id);
    return { id: result.id, amount: result.amount, status: result.status };
  });

export const listRouters = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "routers.read");
    const { listTenantRouters, listAvailablePools, ensureTenantProvisioning } = await import("./router-provisioning");
    const { previewTenantDomain } = await import("./domain-resolve");
    const { ensureTenantHub } = await import("./wireguard");
    const [routers, pools, provisioning, hub, domain] = await Promise.all([
      listTenantRouters(sql, workspace.tenantId),
      listAvailablePools(sql, workspace.tenantId),
      ensureTenantProvisioning(sql, workspace.tenantId),
      ensureTenantHub(sql, workspace.tenantId).catch(() => null),
      previewTenantDomain(sql, workspace.tenantId, "router_bootstrap").catch(() => null),
    ]);
    return { workspace, routers, pools, provisioning, hub, domain };
  });

export const addRouter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      name: string;
      location?: string;
      identity?: string;
      role?: string;
      model?: string;
      ros_version?: string;
      site_pop?: string;
      management_ip?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    if (!data.name.trim()) throw new Error("Name is required");
    assertPermission(workspace.role, "routers.manage");
    await assertRouterQuota(sql, workspace.tenantId);
    await assertFeature(sql, workspace.tenantId, "mikrotik");
    const id = nid("rtr");
    const enroll = enrollFields(data.name);
    const wgAddress = await nextWgAddress(sql, workspace.tenantId);
    const name = data.name.trim();
    const site = (data.site_pop || data.location || "").trim();
    const identity = (data.identity || "").trim() || name.toLowerCase();
    await sql`insert into routers (
        id, tenant_id, name, location, identity, role, wg_status, last_seen, cpu_pct, uptime_hours,
        enroll_token, wg_public, wg_address, agent_version, wg_private_ref,
        model, ros_version, site_pop, management_ip, provisioning_status
      ) values (
        ${id}, ${workspace.tenantId}, ${name}, ${site}, ${identity}, ${data.role || "access"},
        'pending', null, 0, 0, ${enroll.token}, ${enroll.wg_public}, ${wgAddress}, '0.2.0',
        ${enroll.wg_private_sealed}, ${(data.model || "").trim()}, ${(data.ros_version || "").trim()},
        ${site}, ${(data.management_ip || "").trim()}, 'pending'
      )`;
    await audit(sql, workspace.tenantId, context.userId, "router.created", "router", id);
    const { issueProvisioningToken, recordProvisionEvent } = await import("./router-provisioning");
    await recordProvisionEvent(sql, {
      tenantId: workspace.tenantId,
      routerId: id,
      event: "created",
      actorUserId: context.userId,
      detail: { name },
    });
    const { tenantPublicOriginOrEmpty, previewTenantDomain } = await import("./domain-resolve");
    const preview = await previewTenantDomain(sql, workspace.tenantId, "router_bootstrap");
    let issued: Awaited<ReturnType<typeof issueProvisioningToken>> | null = null;
    let domainError = preview.ok ? "" : preview.error;
    if (preview.ok) {
      issued = await issueProvisioningToken(sql, {
        tenantId: workspace.tenantId,
        routerId: id,
        actorUserId: context.userId,
      });
    }
    const base = preview.origin || (await tenantPublicOriginOrEmpty(sql, workspace.tenantId, "public_api"));
    const script = agentScript(
      await wgEnrollContext(sql, workspace.tenantId, {
        id,
        name,
        identity,
        token: enroll.token,
        wg_public: enroll.wg_public,
        wg_private_ref: enroll.wg_private_sealed,
        wg_address: wgAddress,
        pullUrl: agentPullUrl(base, enroll.token),
      }),
    );
    return {
      id,
      script,
      token: enroll.token,
      bootstrap: issued?.bootstrap || "",
      provision_token: issued?.token || "",
      provision_expires_at: issued?.expires_at || "",
      domain_error: domainError,
      domain_source: issued?.domain_source_label || preview.source_label,
      public_url: issued?.public_url || preview.origin,
      fetch_url: issued?.fetch_url || "",
      router: issued?.router,
    };
  });

export const listTickets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "tickets.read");
    const tickets = await sql<TicketRow>`
      select t.id, t.customer_id, c.name as customer_name, t.title, t.category, t.priority, t.status, t.assigned_to, t.created_at::text as created_at
      from tickets t left join customers c on c.id = t.customer_id
      where t.tenant_id = ${workspace.tenantId}
      order by t.created_at desc`;
    const customers = await sql<{ id: string; name: string }>`select id, name from customers where tenant_id = ${workspace.tenantId} and deleted_at is null order by name`;
    return { workspace, tickets, customers };
  });

export const createTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { title: string; category: string; priority: string; customer_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "tickets.manage");
    if (!data.title.trim()) throw new Error("Title is required");
    const opened = await openTicket(sql, workspace.tenantId, data);
    await audit(sql, workspace.tenantId, context.userId, "ticket.created", "ticket", opened.id);
    return opened;
  });

export const setTicketStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; status: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, workspace.role === "technician" ? "jobs.update" : "tickets.manage");
    if (workspace.role === "technician") {
      const [t] = await sql<{ assigned_to: string }>`
        select assigned_to from tickets where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
      if (t && t.assigned_to && t.assigned_to !== context.userId) throw new Error("Not assigned to you");
    }
    await sql`update tickets set status = ${data.status} where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
    return { ok: true };
  });

export const renameTenant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string; supportEmail: string; supportPhone: string; dateFormat?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "settings.manage");
    const name = data.name.trim();
    if (!name) throw new Error("Name is required");
    const { normalizeDateFormat } = await import("./display");
    const dateFormat = normalizeDateFormat(data.dateFormat);
    await sql`update tenants set name = ${name}, support_email = ${data.supportEmail.trim()}, support_phone = ${data.supportPhone.trim()},
      date_format = ${dateFormat}
      where id = ${workspace.tenantId}`;
    return { ok: true, dateFormat };
  });

export type ImportRow = {
  name: string;
  phone: string;
  email: string;
  address: string;
  access_method: AccessMethod;
  username: string;
  static_ip: string;
  package_name: string;
};

export const importCustomers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { rows: ImportRow[] }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "customers.manage");
    await assertCustomerQuota(sql, workspace.tenantId);
    const { confirmCustomerImport } = await import("./onboard-import");
    const header = "name,phone,email,address,access_method,username,static_ip,package_name";
    const csv = [
      header,
      ...data.rows.map((row) =>
        [row.name, row.phone, row.email, row.address, row.access_method, row.username, row.static_ip, row.package_name]
          .map((v) => `"${String(v || "").replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const result = await confirmCustomerImport(sql, {
      tenantId: workspace.tenantId,
      tenantName: workspace.tenantName,
      actorId: context.userId,
      input: { text: csv, mode: "new" },
    });
    return { created: result.created + result.attached, errors: result.errors };
  });

export const exportCustomersCsv = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "customers.read");
    const rows = await sql<{
      name: string;
      phone: string;
      email: string;
      address: string;
      account_number: string;
      access_method: string | null;
      username: string | null;
      static_ip: string | null;
      package_name: string | null;
      service_status: string | null;
      onboarding_type: string | null;
      period_end: string | null;
    }>`
      select c.name, c.phone, c.email, c.address, coalesce(c.account_number,'') as account_number, s.access_method, s.username, s.static_ip, p.name as package_name, s.status as service_status,
             coalesce(s.onboarding_type,'new') as onboarding_type, s.period_end::text as period_end
      from customers c
      left join services s on s.customer_id = c.id and s.deleted_at is null
      left join packages p on p.id = s.package_id
      where c.tenant_id = ${workspace.tenantId} and c.deleted_at is null
      order by c.name`;
    const header = "name,phone,email,address,account_number,access_method,username,static_ip,package_name,service_status,onboarding_type,subscription_expiry_date";
    const body = rows
      .map((r) =>
        [r.name, r.phone, r.email, r.address, r.account_number ?? "", r.access_method ?? "", r.username ?? "", r.static_ip ?? "", r.package_name ?? "", r.service_status ?? "", r.onboarding_type ?? "", (r.period_end || "").slice(0, 10)]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    return `${header}\n${body}\n`;
  });

export type NotificationLogRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  event_code: string;
  channel: string;
  subject: string;
  body: string;
  destination: string;
  status: string;
  created_at: string;
};

export type NotificationTemplateRow = {
  id: string;
  event_code: string;
  channel: string;
  subject: string;
  body: string;
  enabled: boolean;
};

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "settings.manage");
    await ensureDefaultTemplates(sql, workspace.tenantId);
    const logs = await sql<NotificationLogRow>`
      select n.id, n.customer_id, c.name as customer_name, n.event_code, n.channel, n.subject, n.body,
             n.destination, n.status, n.created_at::text as created_at
      from notification_logs n
      left join customers c on c.id = n.customer_id
      where n.tenant_id = ${workspace.tenantId}
      order by n.created_at desc
      limit 100`;
    const templates = await sql<NotificationTemplateRow>`
      select id, event_code, channel, subject, body, enabled
      from notification_templates where tenant_id = ${workspace.tenantId}
      order by event_code, channel`;
    const inbox = await listInbox(sql, workspace.tenantId);
    return { workspace, logs, templates, inbox };
  });

export const updateNotificationTemplate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; subject: string; body: string; enabled: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "settings.manage");
    const rows = await sql<{ id: string }>`
      update notification_templates
      set subject = ${data.subject}, body = ${data.body}, enabled = ${data.enabled}
      where id = ${data.id} and tenant_id = ${workspace.tenantId}
      returning id`;
    if (!rows[0]) throw new Error("Template not found");
    return { ok: true };
  });

export const runAutomatedBilling = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "invoices.manage");
    const result = await runBillingCycle(sql, workspace.tenantId, workspace.tenantName);
    await audit(sql, workspace.tenantId, context.userId, "billing.cycle", "billing", workspace.tenantId);
    return result;
  });
