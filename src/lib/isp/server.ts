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
import { issueInvoice } from "./billing";
import { loadChurnScores } from "./churn";
import { loadDashboard } from "./dashboard";
import { requestPublicOrigin } from "./auth-origins";
import { completeOperatorReset, requestOperatorReset } from "./password-reset";
import { agentPullUrl, agentScript, enrollFields, enqueuePackageProfiles, wgAddressForIndex } from "./agent";
import { mikrotikProfileName } from "./pcq";
import { mikrotikRateLimit } from "./radius-format";
import { wgEnrollContext } from "./wireguard";
import { emit } from "./events";
import { listInbox } from "./inbox";
import { applyConfirmedPayment } from "./payments";
import { consumeActiveGrantsForCustomer, getGracePolicy } from "./grace";
import { groupAssignments, listTags, loadAssignments, setCustomerTags } from "./tags";
import { assertPermission } from "./rbac";
import { assertCustomerQuota, assertRouterQuota, assertTenantOperable } from "./saas";
import { assertFeature, featureForAccess } from "./plans";
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
  RouterRow,
  ServiceRow,
  ServiceStatus,
  TicketRow,
  Workspace,
} from "./types";

type Sql = Awaited<ReturnType<typeof getSql>>;

async function audit(
  sql: Sql,
  tenantId: string,
  userId: string,
  action: string,
  entityType = "",
  entityId = "",
) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, ${entityType}, ${entityId})`;
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
      select c.id, c.type, c.name, c.phone, c.email, c.address, c.status, c.created_at::text as created_at,
        (select count(*)::int from services s where s.customer_id = c.id) as service_count,
        (select coalesce(sum(greatest(0, i.amount_kes - i.paid_kes)),0)::int from invoices i where i.customer_id = c.id and i.status in ('due','overdue','issued','partial')) as balance_kes
      from customers c
      where c.tenant_id = ${workspace.tenantId}
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
      where s.tenant_id = ${workspace.tenantId}`;
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
  .validator((d: { name: string; phone: string; email: string; address: string; type: string; portal_password?: string; tag_ids?: string[] }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "customers.manage");
    const name = data.name.trim();
    if (!name) throw new Error("Name is required");
    await assertCustomerQuota(sql, workspace.tenantId);
    const id = nid("cus");
    await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status)
      values (${id}, ${workspace.tenantId}, ${data.type || "individual"}, ${name}, ${data.phone.trim()}, ${data.email.trim()}, ${data.address.trim()}, 'active')`;
    if (data.portal_password) {
      const { setPortalPassword } = await import("./portal");
      await setPortalPassword(sql, workspace.tenantId, id, data.portal_password);
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
  .validator((d: { id: string; name: string; phone: string; email: string; address: string; type: string; tag_ids?: string[] }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "customers.manage");
    const name = data.name.trim();
    if (!name) throw new Error("Name is required");
    const rows = await sql<{ id: string }>`
      update customers
      set name = ${name}, phone = ${data.phone.trim()}, email = ${data.email.trim()}, address = ${data.address.trim()}, type = ${data.type || "individual"}
      where id = ${data.id} and tenant_id = ${workspace.tenantId}
      returning id`;
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
      select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active
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
    await sql`insert into packages (id, tenant_id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active)
      values (${id}, ${workspace.tenantId}, ${data.name.trim()}, ${data.description}, ${data.access_method}, ${data.download_mbps}, ${data.upload_mbps}, ${data.price_kes}, ${data.billing_interval}, ${data.grace_days}, ${Math.max(0, data.bundle_mb ?? 0)}, ${Math.max(0, data.validity_hours ?? 0)}, true)`;
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
    active: boolean;
  }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "packages.manage");
    if (!data.name.trim()) throw new Error("Name is required");
    if (!["pppoe", "static", "hotspot"].includes(data.access_method)) {
      throw new Error("Access method must be PPPoE, static, or hotspot");
    }
    const rows = await sql<{ id: string }>`
      update packages
      set name = ${data.name.trim()},
          description = ${data.description},
          access_method = ${data.access_method},
          download_mbps = ${data.download_mbps},
          upload_mbps = ${data.upload_mbps},
          price_kes = ${data.price_kes},
          billing_interval = ${data.billing_interval},
          grace_days = ${data.grace_days},
          bundle_mb = ${Math.max(0, data.bundle_mb ?? 0)},
          validity_hours = ${Math.max(0, data.validity_hours ?? 0)},
          active = ${data.active}
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
    await audit(sql, workspace.tenantId, context.userId, "package.updated", "package", data.id);
    return { id: data.id };
  });

export const listServices = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.read");
    const services = await sql<ServiceRow>`
      select s.id, s.customer_id, c.name as customer_name, s.package_id, p.name as package_name,
             s.access_method, s.username, s.static_ip, s.status, s.created_at::text as created_at,
             s.period_end::text as period_end, s.bundle_used_mb, p.bundle_mb, s.suspend_reason,
             (g.id is not null) as grace_active, g.days_granted as grace_days_granted,
             g.starts_at::text as grace_starts_at, g.expires_at::text as grace_expires_at,
             g.granted_by_label as grace_granted_by, g.reason as grace_reason, p.grace_days as package_grace_days
      from services s
      join customers c on c.id = s.customer_id
      join packages p on p.id = s.package_id
      left join service_grace_periods g
        on g.service_id = s.id and g.tenant_id = s.tenant_id and g.status = 'active'
      where s.tenant_id = ${workspace.tenantId}
      order by s.created_at desc`;
    const customers = await sql<{ id: string; name: string }>`select id, name from customers where tenant_id = ${workspace.tenantId} order by name`;
    const packages = await sql<PackageRow>`
      select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active
      from packages where tenant_id = ${workspace.tenantId} and active = true`;
    const gracePolicy = await getGracePolicy(sql, workspace.tenantId);
    return { workspace, services, customers, packages, gracePolicy };
  });

export const createService = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: {
    customer_id: string;
    package_id: string;
    username?: string;
    static_ip?: string;
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
    const [cus] = await sql<{ id: string }>`select id from customers where id = ${data.customer_id} and tenant_id = ${tid}`;
    if (!cus) throw new Error("Customer not found");
    const id = nid("svc");
    const { periodMs } = await import("./access-policy");
    const periodEnd = new Date(Date.now() + periodMs(pkg.billing_interval, pkg.validity_hours)).toISOString();
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end)
      values (${id}, ${tid}, ${data.customer_id}, ${data.package_id}, ${pkg.access_method}, ${data.username || null}, ${data.static_ip || null}, 'active', ${periodEnd})`;
    if (pkg.access_method === "static" && !data.static_ip) {
      await allocateStaticIp(sql, tid, id, data.customer_id);
    }
    const radius = await provisionServiceAccess(sql, tid, id);
    const unpaid = await sql<{ id: string }>`
      select id from invoices where tenant_id = ${tid} and customer_id = ${data.customer_id}
      and status in ('issued','due','overdue','partial') limit 1`;
    if (!unpaid[0] && pkg.price_kes > 0) {
      const due = new Date();
      due.setDate(due.getDate() + 7);
      const inv = await issueInvoice(sql, {
        tenantId: tid,
        customerId: data.customer_id,
        dueDate: due.toISOString().slice(0, 10),
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
        due_date: due.toISOString().slice(0, 10),
      });
    }
    await audit(sql, tid, context.userId, "service.created", "service", id);
    return { id, username: radius?.username, password: radius?.password };
  });

export const setServiceStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; status: ServiceStatus }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.manage");
    if (data.status === "active") {
      const [row] = await sql<{ customer_id: string }>`
        select customer_id from services where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
      if (row) {
        const { grantPaidPeriod } = await import("./access-policy");
        await grantPaidPeriod(sql, workspace.tenantId, row.customer_id);
        await consumeActiveGrantsForCustomer(sql, workspace.tenantId, row.customer_id);
      }
    }
    const reason = data.status === "suspended" ? "manual" : data.status === "active" ? "" : "invoice";
    await sql`update services set status = ${data.status}, suspend_reason = ${reason}
      where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
    const [svc] = await sql<{ customer_id: string; name: string }>`
      select s.customer_id, p.name from services s join packages p on p.id = s.package_id
      where s.id = ${data.id} and s.tenant_id = ${workspace.tenantId}`;
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
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "services.manage");
    const out = await rotateServicePassword(sql, workspace.tenantId, data.id);
    await audit(sql, workspace.tenantId, context.userId, "service.password", "service", data.id);
    return out;
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
             i.status, i.due_date::text as due_date, i.issued_at::text as issued_at, i.notes
      from invoices i join customers c on c.id = i.customer_id
      where i.tenant_id = ${tid}
      order by i.issued_at desc`;
    const payments = await sql<PaymentRow>`
      select p.id, p.customer_id, c.name as customer_name, p.invoice_id, p.provider, p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at
      from payments p join customers c on c.id = p.customer_id
      where p.tenant_id = ${tid}
      order by p.paid_at desc`;
    const customers = await sql<{ id: string; name: string; phone: string }>`
      select id, name, phone from customers where tenant_id = ${tid} order by name`;
    const quotes = await sql<{
      customer_id: string;
      package_id: string;
      service_id: string;
      package_name: string;
      price_kes: number;
      billing_interval: string;
    }>`
      select s.customer_id, p.id as package_id, s.id as service_id, p.name as package_name, p.price_kes, p.billing_interval
      from services s join packages p on p.id = s.package_id
      where s.tenant_id = ${tid} and s.status in ('active','grace','suspended','pending')
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
    const [cus] = await sql<{ id: string }>`select id from customers where id = ${data.customer_id} and tenant_id = ${tid}`;
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
    const routers = await sql<RouterRow>`
      select id, name, location, identity, role, wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours,
             wg_public, wg_address, agent_version
      from routers where tenant_id = ${workspace.tenantId} order by name`;
    return { workspace, routers };
  });

export const addRouter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string; location: string; identity: string; role: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    if (!data.name.trim()) throw new Error("Name is required");
    assertPermission(workspace.role, "routers.manage");
    await assertRouterQuota(sql, workspace.tenantId);
    await assertFeature(sql, workspace.tenantId, "mikrotik");
    const id = nid("rtr");
    const count = await sql<{ n: number }>`select count(*)::int as n from routers where tenant_id = ${workspace.tenantId}`;
    const enroll = enrollFields(data.name);
    const wgAddress = wgAddressForIndex((count[0]?.n ?? 0) + 1);
    await sql`insert into routers (id, tenant_id, name, location, identity, role, wg_status, last_seen, cpu_pct, uptime_hours, enroll_token, wg_public, wg_address, agent_version, wg_private_ref)
      values (${id}, ${workspace.tenantId}, ${data.name.trim()}, ${data.location.trim()}, ${data.identity.trim() || data.name.trim().toLowerCase()}, ${data.role || "access"}, 'pending', now(), 0, 0, ${enroll.token}, ${enroll.wg_public}, ${wgAddress}, '0.2.0', ${enroll.wg_private_sealed})`;
    await audit(sql, workspace.tenantId, context.userId, "router.created", "router", id);
    const [ten] = await sql<{ public_base_url: string }>`select public_base_url from tenants where id = ${workspace.tenantId}`;
    const script = agentScript(
      await wgEnrollContext(sql, workspace.tenantId, {
        id,
        name: data.name.trim(),
        identity: data.identity.trim() || data.name.trim().toLowerCase(),
        token: enroll.token,
        wg_public: enroll.wg_public,
        wg_private_ref: enroll.wg_private_sealed,
        wg_address: wgAddress,
        pullUrl: agentPullUrl(ten?.public_base_url || "", enroll.token),
      }),
    );
    return { id, script, token: enroll.token };
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
    const customers = await sql<{ id: string; name: string }>`select id, name from customers where tenant_id = ${workspace.tenantId} order by name`;
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
  .validator((d: { name: string; supportEmail: string; supportPhone: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, workspace } = await requireTenant(context.userId);
    assertPermission(workspace.role, "settings.manage");
    const name = data.name.trim();
    if (!name) throw new Error("Name is required");
    await sql`update tenants set name = ${name}, support_email = ${data.supportEmail.trim()}, support_phone = ${data.supportPhone.trim()}
      where id = ${workspace.tenantId}`;
    return { ok: true };
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
    const tid = workspace.tenantId;
    const pkgs = await sql<{ id: string; name: string; access_method: AccessMethod }>`
      select id, name, access_method from packages where tenant_id = ${tid}`;
    let created = 0;
    const errors: string[] = [];
    for (let i = 0; i < data.rows.length; i++) {
      const row = data.rows[i];
      const line = i + 2;
      if (!row.name?.trim()) {
        errors.push(`Row ${line}: name required`);
        continue;
      }
      const method = (row.access_method || "pppoe").toLowerCase() as AccessMethod;
      if (!["pppoe", "static", "hotspot"].includes(method)) {
        errors.push(`Row ${line}: invalid access method`);
        continue;
      }
      const pkg =
        pkgs.find((p) => p.name.toLowerCase() === row.package_name.trim().toLowerCase()) ||
        pkgs.find((p) => p.access_method === method);
      if (!pkg) {
        errors.push(`Row ${line}: no matching package`);
        continue;
      }
      if (method === "pppoe" && !row.username?.trim()) {
        errors.push(`Row ${line}: PPPoE username required`);
        continue;
      }
      if (method === "static" && !row.static_ip?.trim()) {
        errors.push(`Row ${line}: static IP required`);
        continue;
      }
      const cid = nid("cus");
      await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status)
        values (${cid}, ${tid}, 'individual', ${row.name.trim()}, ${row.phone || ""}, ${row.email || ""}, ${row.address || ""}, 'active')`;
      const sid = nid("svc");
      const periodEnd = new Date(Date.now() + 30 * 86400_000).toISOString();
      await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end)
        values (${sid}, ${tid}, ${cid}, ${pkg.id}, ${method}, ${row.username || null}, ${row.static_ip || null}, 'pending', ${periodEnd})`;
      await provisionServiceAccess(sql, tid, sid);
      created += 1;
    }
    await audit(sql, tid, context.userId, "customers.imported", "customer", String(created));
    return { created, errors };
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
      access_method: string | null;
      username: string | null;
      static_ip: string | null;
      package_name: string | null;
      service_status: string | null;
    }>`
      select c.name, c.phone, c.email, c.address, s.access_method, s.username, s.static_ip, p.name as package_name, s.status as service_status
      from customers c
      left join services s on s.customer_id = c.id
      left join packages p on p.id = s.package_id
      where c.tenant_id = ${workspace.tenantId}
      order by c.name`;
    const header = "name,phone,email,address,access_method,username,static_ip,package_name,service_status";
    const body = rows
      .map((r) =>
        [r.name, r.phone, r.email, r.address, r.access_method ?? "", r.username ?? "", r.static_ip ?? "", r.package_name ?? "", r.service_status ?? ""]
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
