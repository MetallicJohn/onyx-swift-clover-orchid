import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { nid } from "@/lib/utils";
import { agentScript } from "./agent";
import { pullCommands } from "./mikrotik";
import {
  deliverSms,
  deliverWhatsapp,
  getMessagingSettings,
  saveMessagingSettings,
  toPublic,
  webfamBalance,
} from "./messaging";
import { activateVoucher, expireDueVouchers, generateVouchers, revokeVoucher } from "./hotspot";
import { listCustomerInbox } from "./inbox";
import { createStkIntent, settleStkIntent } from "./payments";
import { disconnectRadiusUser, publicRadiusAccount, renderFreeRadiusUsers } from "./radius";
import { ensureRadiusApiKey, radiusConfigBundle, rotateRadiusApiKey } from "./radius-rest";
import { open } from "./secrets";
import { assertPermission } from "./rbac";
import { changePortalPassword, issuePortalOtp, portalContext, portalPasswordLogin, verifyPortalOtp } from "./portal";
import { completePortalPasswordReset } from "./password-reset";
import { issueResellerOtp, resellerHome, verifyResellerOtp } from "./reseller-portal";
import { openTicket } from "./tickets";
import { requireWorkspace as requireWs } from "./workspace";

export const listRadius = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const key = await ensureRadiusApiKey(sql, tenantId);
    const [tenant] = await sql<{ slug: string; public_base_url: string }>`
      select slug, public_base_url from tenants where id = ${tenantId}`;
    const accounts = await sql<{
      id: string;
      username: string;
      password: string;
      framed_ip: string;
      group_name: string;
      enabled: boolean;
      rate_limit: string;
      customer_name: string;
      status: string;
      access_method: string;
    }>`select a.id, a.username, a.password, a.framed_ip, a.group_name, a.enabled, a.rate_limit,
              c.name as customer_name, s.status, s.access_method
       from radius_accounts a
       join services s on s.id = a.service_id
       join customers c on c.id = s.customer_id
       where a.tenant_id = ${tenantId}
       order by a.username`;
    const sessions = await sql<{
      id: string;
      username: string;
      framed_ip: string;
      nas_ip: string;
      bytes_in: number;
      bytes_out: number;
      started_at: string;
      stopped_at: string | null;
    }>`select id, username, framed_ip, nas_ip, bytes_in, bytes_out, started_at::text as started_at, stopped_at::text as stopped_at
       from radius_sessions where tenant_id = ${tenantId} order by started_at desc limit 40`;
    const events = await sql<{
      id: string;
      username: string;
      nas_ip: string;
      result: string;
      reason: string;
      created_at: string;
    }>`select id, username, nas_ip, result, reason, created_at::text as created_at
       from radius_auth_events where tenant_id = ${tenantId} order by created_at desc limit 20`;
    const nas = await sql<{ name: string; nas_ip: string; radius_secret: string }>`
      select name, nas_ip, radius_secret from routers where tenant_id = ${tenantId} order by name`;
    const config = radiusConfigBundle({
      baseUrl: tenant?.public_base_url || "",
      slug: tenant?.slug || "",
      apiKey: key.key || "frk_replace_me",
      nas: nas
        .filter((r) => r.nas_ip)
        .map((r) => ({ name: r.name, ip: r.nas_ip, secret: r.radius_secret ? open(r.radius_secret) || "change-me-on-the-router" : "change-me-on-the-router" })),
    });
    return {
      accounts: accounts.map(publicRadiusAccount),
      sessions,
      events,
      slug: tenant?.slug || "",
      api_key_hint: key.hint,
      api_key: key.key,
      config,
    };
  });

export const rotateRadiusKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    return rotateRadiusApiKey(sql, tenantId);
  });

export const disconnectRadius = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { username: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    return disconnectRadiusUser(sql, tenantId, data.username.trim());
  });

export const exportRadiusUsers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    const accounts = await sql<{
      username: string;
      password: string;
      framed_ip: string;
      group_name: string;
      enabled: boolean;
      rate_limit: string;
    }>`select username, password, framed_ip, group_name, enabled, rate_limit
       from radius_accounts where tenant_id = ${tenantId} order by username`;
    return { users: renderFreeRadiusUsers(accounts) };
  });

export const listHotspot = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    await expireDueVouchers(sql, tenantId);
    const vouchers = await sql<{
      id: string;
      code: string;
      hours: number;
      status: string;
      package_name: string;
      created_at: string;
      expires_at: string | null;
    }>`select v.id, v.code, v.hours, v.status, p.name as package_name, v.created_at::text as created_at, v.expires_at::text as expires_at
       from hotspot_vouchers v join packages p on p.id = v.package_id
       where v.tenant_id = ${tenantId} order by v.created_at desc`;
    const packages = await sql<{ id: string; name: string }>`
      select id, name from packages where tenant_id = ${tenantId} and access_method = 'hotspot'`;
    const sessions = await sql<{
      id: string;
      username: string;
      framed_ip: string;
      nas_ip: string;
      started_at: string;
      stopped_at: string | null;
    }>`select id, username, framed_ip, nas_ip, started_at::text as started_at, stopped_at::text as stopped_at
       from radius_sessions
       where tenant_id = ${tenantId} and username in (select code from hotspot_vouchers where tenant_id = ${tenantId})
       order by started_at desc limit 20`;
    return { vouchers, packages, sessions };
  });

export const activateHotspotVoucher = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "services.manage");
    return activateVoucher(sql, tenantId, data.id);
  });

export const revokeHotspotVoucher = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "services.manage");
    return revokeVoucher(sql, tenantId, data.id);
  });

export const createVouchers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { package_id: string; count: number; hours: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "services.manage");
    return generateVouchers(sql, tenantId, data.package_id, data.count, data.hours);
  });

export const listAgentQueue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const commands = await sql<{
      id: string;
      router_name: string;
      kind: string;
      payload: string;
      status: string;
      created_at: string;
    }>`select c.id, r.name as router_name, c.kind, c.payload, c.status, c.created_at::text as created_at
       from agent_commands c join routers r on r.id = c.router_id
       where c.tenant_id = ${tenantId}
       order by c.created_at desc limit 40`;
    return { commands };
  });

export const simulateAgentPull = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const [r] = await sql<{ id: string; enroll_token: string; identity: string; name: string; wg_public: string; wg_address: string }>`
      select id, enroll_token, identity, name, wg_public, wg_address from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
    if (!r) throw new Error("Router not found");
    const pulled = r.enroll_token
      ? await pullCommands(sql, r.enroll_token, true)
      : { commands: [] as { id: string }[] };
    if (!r.enroll_token) {
      await sql`update routers set wg_status = 'connected', last_seen = now(), cpu_pct = 12, agent_version = '0.2.0' where id = ${r.id}`;
    }
    return {
      pulled: pulled.commands.length,
      commands: pulled.commands,
      script: agentScript({
        name: r.name,
        identity: r.identity,
        token: r.enroll_token,
        wgPublic: r.wg_public,
        wgAddress: r.wg_address || "10.200.0.2/32",
      }),
    };
  });

export const listProviders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const providers = await sql<{ id: string; kind: string; label: string; enabled: boolean; sandbox: boolean }>`
      select id, kind, label, enabled, sandbox from payment_providers where tenant_id = ${tenantId}`;
    const intents = await sql<{
      id: string;
      checkout_id: string;
      provider: string;
      amount_kes: number;
      phone: string;
      status: string;
      created_at: string;
    }>`select id, checkout_id, provider, amount_kes, phone, status, created_at::text as created_at
       from payment_intents where tenant_id = ${tenantId} order by created_at desc limit 20`;
    return { providers, intents };
  });

export const toggleProvider = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; enabled: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    await sql`update payment_providers set enabled = ${data.enabled} where id = ${data.id} and tenant_id = ${tenantId}`;
    return { ok: true };
  });

export const sendStk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { invoice_id: string; provider: string; amount_kes?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "payments.manage");
    return createStkIntent(sql, {
      tenantId,
      invoiceId: data.invoice_id,
      provider: data.provider || "mpesa",
      amountKes: data.amount_kes,
    });
  });

export const confirmStk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { checkout_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role } = await requireWs(context.userId);
    assertPermission(role, "payments.manage");
    return settleStkIntent(sql, { tenantId, ispName: tenantName, checkoutId: data.checkout_id });
  });

export const listField = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    const tickets =
      role === "technician"
        ? await sql<{
            id: string;
            title: string;
            category: string;
            priority: string;
            status: string;
            assigned_to: string;
            customer_name: string | null;
            phone: string | null;
            address: string | null;
            created_at: string;
          }>`select t.id, t.title, t.category, t.priority, t.status, t.assigned_to, c.name as customer_name, c.phone, c.address, t.created_at::text as created_at
       from tickets t left join customers c on c.id = t.customer_id
       where t.tenant_id = ${tenantId} and t.status not in ('closed','resolved')
         and (t.assigned_to = ${context.userId} or t.assigned_to = '')
       order by case t.priority when 'urgent' then 0 when 'high' then 1 else 2 end, t.created_at`
        : await sql<{
            id: string;
            title: string;
            category: string;
            priority: string;
            status: string;
            assigned_to: string;
            customer_name: string | null;
            phone: string | null;
            address: string | null;
            created_at: string;
          }>`select t.id, t.title, t.category, t.priority, t.status, t.assigned_to, c.name as customer_name, c.phone, c.address, t.created_at::text as created_at
       from tickets t left join customers c on c.id = t.customer_id
       where t.tenant_id = ${tenantId} and t.status not in ('closed','resolved')
       order by case t.priority when 'urgent' then 0 when 'high' then 1 else 2 end, t.created_at`;
    return { tickets };
  });

export const listAcs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const devices = await sql<{
      id: string;
      serial: string;
      product_class: string;
      ssid: string;
      status: string;
      customer_name: string | null;
      last_inform: string;
    }>`select d.id, d.serial, d.product_class, d.ssid, d.status, c.name as customer_name, d.last_inform::text as last_inform
       from cpe_devices d left join customers c on c.id = d.customer_id
       where d.tenant_id = ${tenantId} order by d.last_inform desc`;
    const customers = await sql<{ id: string; name: string }>`select id, name from customers where tenant_id = ${tenantId} order by name`;
    return { devices, customers };
  });

export const addCpe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { serial: string; product_class: string; ssid: string; customer_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    if (!data.serial.trim()) throw new Error("Serial is required");
    await sql`insert into cpe_devices (id, tenant_id, serial, product_class, ssid, status, customer_id)
      values (${nid("cpe")}, ${tenantId}, ${data.serial.trim()}, ${data.product_class || "Router"}, ${data.ssid || ""}, 'online', ${data.customer_id || null})`;
    return { ok: true };
  });

export const informCpe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    await sql`update cpe_devices set last_inform = now(), status = 'online' where id = ${data.id} and tenant_id = ${tenantId}`;
    return { ok: true };
  });

export const listPartners = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const loyalty = await sql<{ customer_id: string; customer_name: string; phone: string; points: number }>`
      select c.id as customer_id, c.name as customer_name, c.phone, l.points
      from loyalty_accounts l join customers c on c.id = l.customer_id
      where l.tenant_id = ${tenantId} order by l.points desc`;
    const referrals = await sql<{
      id: string;
      referrer: string;
      referee_name: string;
      referee_phone: string;
      status: string;
      points: number;
    }>`select r.id, c.name as referrer, r.referee_name, r.referee_phone, r.status, r.points
       from referrals r join customers c on c.id = r.referrer_id
       where r.tenant_id = ${tenantId} order by r.created_at desc`;
    const resellers = await sql<{
      id: string;
      name: string;
      phone: string;
      commission_pct: number;
      status: string;
      balance_kes: number;
    }>`select r.id, r.name, r.phone, r.commission_pct, r.status, coalesce(w.balance_kes, 0)::int as balance_kes
       from resellers r
       left join reseller_wallets w on w.reseller_id = r.id and w.tenant_id = r.tenant_id
       where r.tenant_id = ${tenantId} order by r.name`;
    const customers = await sql<{ id: string; name: string }>`select id, name from customers where tenant_id = ${tenantId} order by name`;
    return { loyalty, referrals, resellers, customers };
  });

export const addReferral = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { referrer_id: string; referee_name: string; referee_phone: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    if (!data.referee_name.trim()) throw new Error("Name required");
    await sql`insert into referrals (id, tenant_id, referrer_id, referee_name, referee_phone, status, points)
      values (${nid("ref")}, ${tenantId}, ${data.referrer_id}, ${data.referee_name.trim()}, ${data.referee_phone.trim()}, 'pending', 200)`;
    return { ok: true };
  });

export const addReseller = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string; phone: string; commission_pct: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    if (!data.name.trim()) throw new Error("Name required");
    await sql`insert into resellers (id, tenant_id, name, phone, commission_pct, status)
      values (${nid("rsl")}, ${tenantId}, ${data.name.trim()}, ${data.phone.trim()}, ${data.commission_pct || 10}, 'active')`;
    return { ok: true };
  });

export const workspaceSlug = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const [t] = await sql<{ slug: string; name: string }>`select slug, name from tenants where id = ${tenantId}`;
    return t ?? { slug: "", name: "" };
  });

export const requestPortalOtp = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return issuePortalOtp(sql, data.slug, data.phone);
  });

export const verifyPortalLogin = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string; code: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return verifyPortalOtp(sql, data.slug, data.phone, data.code);
  });

export const portalPasswordSignIn = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string; password: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return portalPasswordLogin(sql, data.slug, data.phone, data.password);
  });

export const portalChangePassword = createServerFn({ method: "POST" })
  .validator((d: { token: string; current: string; password: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    await changePortalPassword(sql, ctx.tenantId, ctx.customer.id, data.current, data.password);
    return { ok: true };
  });

export const completePortalPasswordResetFn = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string; code: string; password: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return completePortalPasswordReset(sql, data);
  });

export const requestResellerOtp = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return issueResellerOtp(sql, data.slug, data.phone);
  });

export const verifyResellerLogin = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string; code: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return verifyResellerOtp(sql, data.slug, data.phone, data.code);
  });

export const getResellerHome = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return resellerHome(sql, data.token);
  });

export const getPortalHome = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    const services = await sql<{
      package_name: string;
      access_method: string;
      username: string | null;
      status: string;
    }>`select p.name as package_name, s.access_method, s.username, s.status
       from services s join packages p on p.id = s.package_id
       where s.tenant_id = ${ctx.tenantId} and s.customer_id = ${ctx.customer.id}`;
    const invoices = await sql<{
      id: string;
      number: string;
      amount_kes: number;
      paid_kes: number;
      remaining_kes: number;
      status: string;
      due_date: string;
    }>`select id, number, amount_kes, paid_kes,
              case when status = 'paid' then 0 else greatest(0, amount_kes - paid_kes) end as remaining_kes,
              status, due_date::text as due_date
       from invoices where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id}
       order by issued_at desc`;
    const [loy] = await sql<{ points: number }>`
      select points from loyalty_accounts where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id}`;
    const inbox = await listCustomerInbox(sql, ctx.tenantId, ctx.customer.id);
    return { ...ctx, services, invoices, points: loy?.points ?? 0, inbox };
  });

export const portalPay = createServerFn({ method: "POST" })
  .validator((d: { token: string; invoice_id: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    const intent = await createStkIntent(sql, {
      tenantId: ctx.tenantId,
      invoiceId: data.invoice_id,
      provider: "mpesa",
    });
    if (!intent.checkout_id.startsWith("ws_")) {
      return { ...intent, paid: false, note: "Complete the M-Pesa prompt on your phone." };
    }
    try {
      const pay = await settleStkIntent(sql, {
        tenantId: ctx.tenantId,
        ispName: ctx.isp.name,
        checkoutId: intent.checkout_id,
      });
      return { ...intent, paid: true, payment_id: pay.id, note: "Sandbox payment confirmed." };
    } catch (e) {
      return { ...intent, paid: false, note: e instanceof Error ? e.message : "Waiting for payment" };
    }
  });

export const portalOpenTicket = createServerFn({ method: "POST" })
  .validator((d: { token: string; title: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    const opened = await openTicket(sql, ctx.tenantId, {
      title: data.title.trim(),
      category: "support",
      priority: "normal",
      customer_id: ctx.customer.id,
    });
    return opened;
  });

export const getMessaging = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    return toPublic(await getMessagingSettings(sql, tenantId));
  });

export const saveMessaging = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: {
    payment_sms: boolean;
    payment_whatsapp: boolean;
    billing_sms: boolean;
    billing_whatsapp: boolean;
    sms_provider: string;
    sms_sender_id: string;
    sms_username: string;
    sms_api_key: string;
    sms_sandbox: boolean;
    wa_provider: string;
    wa_phone_id: string;
    wa_access_token: string;
    wa_business_id: string;
    wa_sandbox: boolean;
  }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    return toPublic(await saveMessagingSettings(sql, tenantId, data));
  });

export const testMessaging = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { channel: "sms" | "whatsapp"; phone: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName } = await requireWs(context.userId);
    const settings = await getMessagingSettings(sql, tenantId);
    const phone = data.phone.trim();
    if (!phone) throw new Error("Enter a test phone number");
    const msg =
      data.channel === "sms"
        ? `${tenantName}: test payment SMS from Gridline. If you received this, SMS is configured.`
        : `${tenantName}: test payment WhatsApp from Gridline. If you received this, the Cloud API is configured.`;
    return data.channel === "sms" ? deliverSms(settings, phone, msg) : deliverWhatsapp(settings, phone, msg);
  });

export const checkSmsAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const settings = await getMessagingSettings(sql, tenantId);
    if (settings.sms_provider !== "webfam") {
      return { ok: false as const, detail: "Balance check is available for Webfam SMS." };
    }
    return webfamBalance(settings);
  });
