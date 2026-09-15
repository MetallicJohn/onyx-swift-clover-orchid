import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import {
  loadPortalHome,
  loadPortalInvoices,
  loadPortalPaymentMethods,
  loadPortalPayments,
  loadPortalServices,
  loadPortalTickets,
  openPortalTicket,
  pollPortalPayment,
  publicErrorMessage,
  replyPortalTicket,
  requestPortalGrace,
  startPortalPayment,
} from "./customer-portal";
import { rateLimit } from "./rate-limit";
import {
  changePortalPassword,
  issuePortalOtp,
  portalContext,
  portalPasswordLogin,
  revokePortalSession,
  verifyPortalOtp,
} from "./portal";
import { completePortalPasswordReset } from "./password-reset";

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((err) => {
    throw new Error(publicErrorMessage(err));
  });
}

export const portalPasswordSignIn = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string; password: string }) => d)
  .handler(async ({ data }) => {
    const lim = rateLimit(`portal-login:${data.slug}:${data.phone}`, 12, 15 * 60_000);
    if (!lim.ok) throw new Error("Too many sign-in attempts. Try again shortly.");
    const sql = await getSql();
    return wrap(() => portalPasswordLogin(sql, data.slug, data.phone, data.password));
  });

export const requestPortalOtp = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string }) => d)
  .handler(async ({ data }) => {
    const lim = rateLimit(`portal-otp:${data.slug}:${data.phone}`, 8, 15 * 60_000);
    if (!lim.ok) throw new Error("Too many codes requested. Try again shortly.");
    const sql = await getSql();
    return wrap(() => issuePortalOtp(sql, data.slug, data.phone));
  });

export const verifyPortalLogin = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string; code: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return wrap(() => verifyPortalOtp(sql, data.slug, data.phone, data.code));
  });

export const completePortalPasswordResetFn = createServerFn({ method: "POST" })
  .validator((d: { slug: string; phone: string; code: string; password: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    return wrap(() => completePortalPasswordReset(sql, data));
  });

export const portalChangePassword = createServerFn({ method: "POST" })
  .validator((d: { token: string; current: string; password: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    await changePortalPassword(sql, ctx.tenantId, ctx.customer.id, data.current, data.password);
    return { ok: true };
  });

export const portalSignOut = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    await revokePortalSession(sql, data.token);
    return { ok: true };
  });

export const getPortalHome = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(() => loadPortalHome(sql, ctx));
  });

export const getPortalServices = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(async () => ({ services: await loadPortalServices(sql, ctx) }));
  });

export const getPortalInvoices = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(async () => ({ invoices: await loadPortalInvoices(sql, ctx) }));
  });

export const getPortalPayments = createServerFn({ method: "POST" })
  .validator((d: { token: string; q?: string; status?: string; from?: string; to?: string; page?: number }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(() =>
      loadPortalPayments(sql, ctx, {
        q: data.q,
        status: data.status,
        from: data.from,
        to: data.to,
        page: data.page,
      }),
    );
  });

export const getPortalPayMethods = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(async () => ({ methods: await loadPortalPaymentMethods(sql, ctx) }));
  });

export const getPortalTickets = createServerFn({ method: "POST" })
  .validator((d: { token: string; id?: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(async () => ({ tickets: await loadPortalTickets(sql, ctx, data.id) }));
  });

export const portalPay = createServerFn({ method: "POST" })
  .validator((d: { token: string; invoice_id: string; phone?: string; provider?: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(() =>
      startPortalPayment(sql, ctx, { invoice_id: data.invoice_id, phone: data.phone, provider: data.provider }),
    );
  });

export const portalPayStatus = createServerFn({ method: "POST" })
  .validator((d: { token: string; checkout_id: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(() => pollPortalPayment(sql, ctx, data.checkout_id));
  });

export const portalOpenTicket = createServerFn({ method: "POST" })
  .validator((d: { token: string; title: string; category?: string; message?: string; service_id?: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(() =>
      openPortalTicket(sql, ctx, {
        title: data.title,
        category: data.category || "other",
        message: data.message || data.title,
        service_id: data.service_id,
      }),
    );
  });

export const portalReplyTicket = createServerFn({ method: "POST" })
  .validator((d: { token: string; ticket_id: string; message: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(() => replyPortalTicket(sql, ctx, { ticket_id: data.ticket_id, message: data.message }));
  });

export const portalRequestGrace = createServerFn({ method: "POST" })
  .validator((d: { token: string; service_id: string; days: number }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    return wrap(() => requestPortalGrace(sql, ctx, { service_id: data.service_id, days: data.days }));
  });
