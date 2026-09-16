import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import {
  loadPortalHome,
  loadPortalInvoices,
  loadPortalPaymentMethods,
  loadPortalPayments,
  loadPortalServices,
  loadPortalTickets,
  makePortalInvoiceFile,
  makePortalStatementFile,
  openPortalTicket,
  pollPortalPayment,
  publicErrorMessage,
  replyPortalTicket,
  requestPortalGrace,
  startPortalPayment,
} from "@/lib/isp/customer-portal";
import { PORTAL_API_VERSION } from "@/lib/isp/customer-portal-dto";
import { completePortalPasswordReset } from "@/lib/isp/password-reset";
import { rateLimit } from "@/lib/isp/rate-limit";
import {
  changePortalPassword,
  issuePortalOtp,
  portalContext,
  portalPasswordLogin,
  resolvePortalNetwork,
  revokePortalSession,
  verifyPortalOtp,
} from "@/lib/isp/portal";

export const Route = createFileRoute("/api/v1/portal/$action")({
  server: {
    handlers: {
      GET: ({ params, request }) => handlePortalApi(params.action, request, "GET"),
      POST: ({ params, request }) => handlePortalApi(params.action, request, "POST"),
    },
  },
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function tokenFrom(request: Request, body: Record<string, unknown>) {
  const header = request.headers.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers.get("x-portal-token") || "";
  const fromBody = typeof body.token === "string" ? body.token : "";
  return bearer || alt || fromBody;
}

async function handlePortalApi(action: string, request: Request, method: string) {
  try {
    const body = method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
    const url = new URL(request.url);
    const sql = await getSql();

    if (action === "network" && method === "POST") {
      const found = await resolvePortalNetwork(sql, {
        host: String(body.host || url.hostname || ""),
        slug: String(body.slug || url.searchParams.get("slug") || ""),
      });
      if (!found) return json({ error: "Unknown network" }, 404);
      return json({ version: PORTAL_API_VERSION, slug: found.slug, name: found.name, source: found.source });
    }
    if (action === "session" && method === "POST") {
      let slug = String(body.slug || "");
      if (!slug) {
        const found = await resolvePortalNetwork(sql, { host: String(body.host || url.hostname || "") });
        slug = found?.slug || "";
      }
      const phone = String(body.phone || "");
      const password = String(body.password || "");
      const lim = rateLimit(`portal-api:${slug}:${phone}`, 12, 15 * 60_000);
      if (!lim.ok) return json({ error: "Too many sign-in attempts" }, 429);
      const session = await portalPasswordLogin(sql, slug, phone, password);
      return json({
        version: PORTAL_API_VERSION,
        token: session.token,
        customer_id: session.customerId,
        using_initial_password: session.using_initial_password,
      });
    }
    if (action === "otp" && method === "POST") {
      return json(await issuePortalOtp(sql, String(body.slug || ""), String(body.phone || "")));
    }
    if (action === "otp-verify" && method === "POST") {
      const session = await verifyPortalOtp(sql, String(body.slug || ""), String(body.phone || ""), String(body.code || ""));
      return json({
        version: PORTAL_API_VERSION,
        token: session.token,
        customer_id: session.customerId,
        using_initial_password: session.using_initial_password,
      });
    }
    if (action === "password-reset" && method === "POST") {
      const session = await completePortalPasswordReset(sql, {
        slug: String(body.slug || ""),
        phone: String(body.phone || ""),
        code: String(body.code || ""),
        password: String(body.password || ""),
      });
      return json({ version: PORTAL_API_VERSION, token: session.token, customer_id: session.customerId });
    }

    const token = tokenFrom(request, body);
    if (!token) return json({ error: "Sign in required" }, 401);
    const ctx = await portalContext(sql, token);

    if (action === "logout" && method === "POST") {
      await revokePortalSession(sql, token);
      return json({ ok: true });
    }
    if (action === "me" || action === "dashboard") return json({ version: PORTAL_API_VERSION, ...(await loadPortalHome(sql, ctx)) });
    if (action === "services") return json({ services: await loadPortalServices(sql, ctx) });
    if (action === "invoices") return json({ invoices: await loadPortalInvoices(sql, ctx) });
    if (action === "payments") {
      return json(
        await loadPortalPayments(sql, ctx, {
          q: url.searchParams.get("q") || String(body.q || ""),
          status: url.searchParams.get("status") || String(body.status || ""),
          from: url.searchParams.get("from") || String(body.from || ""),
          to: url.searchParams.get("to") || String(body.to || ""),
          page: Number(url.searchParams.get("page") || body.page || 1),
        }),
      );
    }
    if (action === "methods") return json({ methods: await loadPortalPaymentMethods(sql, ctx) });
    if (action === "tickets" && method === "GET") return json({ tickets: await loadPortalTickets(sql, ctx) });
    if (action === "tickets" && method === "POST") {
      const opened = await openPortalTicket(sql, ctx, {
        title: String(body.title || ""),
        category: String(body.category || "other"),
        message: String(body.message || body.title || ""),
        service_id: body.service_id ? String(body.service_id) : undefined,
      });
      return json(opened);
    }
    if (action === "ticket-reply" && method === "POST") {
      return json(await replyPortalTicket(sql, ctx, { ticket_id: String(body.ticket_id || ""), message: String(body.message || "") }));
    }
    if (action === "pay" && method === "POST") {
      return json(
        await startPortalPayment(sql, ctx, {
          invoice_id: body.invoice_id ? String(body.invoice_id) : undefined,
          service_id: body.service_id ? String(body.service_id) : undefined,
          phone: body.phone ? String(body.phone) : undefined,
          provider: body.provider ? String(body.provider) : undefined,
          confirm_account: body.confirm_account ? String(body.confirm_account) : undefined,
        }),
      );
    }
    if (action === "pay-status") {
      const checkout = String(body.checkout_id || url.searchParams.get("checkout_id") || "");
      return json(await pollPortalPayment(sql, ctx, checkout));
    }
    if (action === "password" && method === "POST") {
      await changePortalPassword(sql, ctx.tenantId, ctx.customer.id, String(body.current || ""), String(body.password || ""));
      return json({ ok: true });
    }
    if (action === "grace" && method === "POST") {
      return json(
        await requestPortalGrace(sql, ctx, { service_id: String(body.service_id || ""), days: Number(body.days || 0) }),
      );
    }
    if (action === "invoice-pdf") {
      const { filename, pdf } = await makePortalInvoiceFile(sql, ctx, String(body.id || url.searchParams.get("id") || ""));
      return json({ filename, mime: "application/pdf", base64: pdf.toString("base64") });
    }
    if (action === "statement-pdf") {
      const { filename, pdf } = await makePortalStatementFile(sql, ctx);
      return json({ filename, mime: "application/pdf", base64: pdf.toString("base64") });
    }
    return json({ error: "Unknown action" }, 404);
  } catch (err) {
    const msg = publicErrorMessage(err);
    const status = /sign in|session expired/i.test(msg) ? 401 : /not found/i.test(msg) ? 404 : 400;
    return json({ error: msg }, status);
  }
}
