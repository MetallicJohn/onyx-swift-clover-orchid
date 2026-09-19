import { applyPaymentAccess } from "./partial-payment";
import { enqueueServiceCommand } from "./agent";
import { on, type DomainEvent, type Sql } from "./events";
import { awardLoyalty } from "./loyalty";
import { buildServiceNotifyVars, notifyQuietly } from "./notifications";
import { nid } from "../utils.ts";
import { syncRadiusAccount } from "./radius";
import { creditReseller } from "./resellers";
import { convertReferral } from "./referrals";
import { writeInbox } from "./inbox";

let wired = false;

async function auditSystem(sql: Sql, tenantId: string, action: string, entityType: string, entityId: string, details = "") {
  try {
    await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
      values (${nid("aud")}, ${tenantId}, ${"system"}, ${action}, ${entityType}, ${entityId}, ${details})`;
  } catch {
    /* audit is best-effort on payment callbacks */
  }
}

export function wireModules() {
  if (wired) return;
  wired = true;

  on("payment.confirmed", async (sql, event) => {
    const p = event.payload;
    const tenantId = event.tenantId;
    const customerId = String(p.customer_id || "");
    const ispName = String(p.isp_name || "");
    const payId = String(p.payment_id || "");
    const amount = Number(p.amount_kes || 0);
    const serviceId = String(p.service_id || "");
    const invoicePaid = p.invoice_paid !== false;

    let prior: { status: string; suspend_reason: string; access_method: string } | null = null;
    if (serviceId) {
      const [row] = await sql<{ status: string; suspend_reason: string; access_method: string }>`
        select status, coalesce(suspend_reason,'') as suspend_reason, access_method
        from services where id = ${serviceId} and tenant_id = ${tenantId} and deleted_at is null`;
      prior = row ?? null;
    }
    const wasAwaiting = Boolean(prior && prior.suspend_reason === "awaiting_payment");
    const wasActive = prior?.status === "active";
    const wasDown = Boolean(prior && ["grace", "suspended", "pending"].includes(prior.status));
    const hotspot = prior?.access_method === "hotspot";

    await applyPaymentAccess(sql, {
      tenantId,
      ispName,
      customerId,
      serviceId: serviceId || undefined,
      invoiceId: String(p.invoice_id || "") || undefined,
      paymentId: payId,
      amountKes: amount,
      paidKes: amount,
      invoicePaid,
      reference: String(p.reference || ""),
      provider: String(p.provider || ""),
      invoiceNumber: String(p.invoice_number || ""),
    });
    if (hotspot && serviceId) {
      const { fulfillHotspotPurchase } = await import("./hotspot-purchase.ts");
      await fulfillHotspotPurchase(sql, tenantId, serviceId);
    }
    let businessHandled = false;
    let creditRestored = false;
    if (serviceId) {
      try {
        const { evaluateBusinessCredit, notifyBusinessPayment } = await import("./business-credit.ts");
        const ev = await evaluateBusinessCredit(sql, {
          tenantId,
          serviceId,
          ispName,
          paymentId: payId,
        });
        const [live] = await sql<{ status: string; enabled: boolean | null }>`
          select s.status, ra.enabled
          from services s
          left join radius_accounts ra on ra.service_id = s.id and ra.tenant_id = s.tenant_id
          where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
        const provisioned = live?.status === "active" && live?.enabled !== false;
        creditRestored = Boolean(ev?.restored) || Boolean(!wasActive && wasDown && live?.status === "active");
        if (invoicePaid && !wasAwaiting) {
          businessHandled = await notifyBusinessPayment(sql, {
            tenantId,
            ispName,
            customerId,
            serviceId,
            paymentId: payId,
            amountKes: amount,
            reference: String(p.reference || ""),
            restored: creditRestored,
            provisioned,
          });
        }
      } catch {
        businessHandled = false;
      }
    }
    await awardLoyalty(sql, tenantId, customerId, amount, "payment", payId);
    try {
      await creditReseller(sql, tenantId, customerId, amount, payId);
    } catch {
      /* reseller wallet is optional */
    }

    try {
      const vars = await buildServiceNotifyVars(sql, tenantId, ispName, {
        customerId,
        serviceId: serviceId || null,
        amountKes: amount,
        invoiceNumber: String(p.invoice_number || ""),
        paymentReference: String(p.reference || ""),
      });
      await auditSystem(sql, tenantId, "payment.received", "payment", payId, JSON.stringify({ service_id: serviceId, invoice_paid: invoicePaid }));

      if (hotspot) {
        /* Captive hotspot buy does not send SMS/email/WhatsApp/push. */
      } else if (!invoicePaid) {
        /* partial payment SMS is sent from applyPaymentAccess */
      } else if (wasAwaiting) {
        await notifyQuietly(sql, tenantId, ispName, customerId, "payment.received.awaiting", payId, vars);
        const [live] = await sql<{ status: string; enabled: boolean | null }>`
          select s.status, ra.enabled
          from services s
          left join radius_accounts ra on ra.service_id = s.id and ra.tenant_id = s.tenant_id
          where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
        const provisioned = live?.status === "active" && live?.enabled !== false;
        if (provisioned) {
          const activatedVars = await buildServiceNotifyVars(sql, tenantId, ispName, {
            customerId,
            serviceId,
            amountKes: amount,
            invoiceNumber: String(p.invoice_number || ""),
            paymentReference: String(p.reference || ""),
          });
          await notifyQuietly(sql, tenantId, ispName, customerId, "service.activated", `${serviceId}:${payId}`, activatedVars);
          await auditSystem(sql, tenantId, "service.activated", "service", serviceId, JSON.stringify({ payment_id: payId }));
        }
      } else if (businessHandled) {
        /* business payment / restore SMS already sent */
      } else {
        await notifyQuietly(sql, tenantId, ispName, customerId, "payment.received", payId, vars);
        if (!wasActive && wasDown && invoicePaid) {
          await notifyQuietly(sql, tenantId, ispName, customerId, "service.restored", `${payId}-restore`, vars);
        }
      }
    } catch {
      /* notifications must not roll back a confirmed payment */
    }
  });

  on("service.changed", async (sql: Sql, event: DomainEvent) => {
    const p = event.payload;
    const service = {
      id: String(p.id || ""),
      access_method: String(p.access_method || ""),
      username: p.username ? String(p.username) : null,
      static_ip: p.static_ip ? String(p.static_ip) : null,
      status: String(p.status || ""),
      package_name: String(p.package_name || ""),
      download_mbps: Number(p.download_mbps || 10),
      upload_mbps: Number(p.upload_mbps || 10),
      password: p.password ? String(p.password) : undefined,
      suspend_reason: p.suspend_reason ? String(p.suspend_reason) : undefined,
    };
    const radius = await syncRadiusAccount(sql, event.tenantId, service);
    await enqueueServiceCommand(sql, event.tenantId, {
      ...service,
      username: radius.username,
      password: service.password || radius.password,
    });
  });

  on("ticket.created", async (sql, event) => {
    const cid = String(event.payload.customer_id || "");
    if (!cid) return;
    try {
      await writeInbox(
        sql,
        event.tenantId,
        cid,
        "Support ticket opened",
        String(event.payload.title || "A ticket was opened on your account"),
        "ticket.created",
      );
    } catch {
      /* inbox is best-effort */
    }
  });

  on("customer.created", async (sql, event) => {
    try {
      await convertReferral(sql, event.tenantId, String(event.payload.phone || ""));
    } catch {
      /* referral convert is best-effort */
    }
  });
}
