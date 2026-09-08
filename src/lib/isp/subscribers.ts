import { restoreCustomerAccess } from "./access";
import { enqueueServiceCommand } from "./agent";
import { on, type DomainEvent, type Sql } from "./events";
import { awardLoyalty } from "./loyalty";
import { notifyCustomerEvent } from "./notifications";
import { syncRadiusAccount } from "./radius";

let wired = false;

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
    await restoreCustomerAccess(sql, tenantId, customerId);
    await awardLoyalty(sql, tenantId, customerId, amount);
    try {
      await notifyCustomerEvent(sql, tenantId, ispName, customerId, "payment.received", payId, {
        customer_name: "",
        invoice_number: String(p.invoice_number || ""),
        amount: `KES ${amount}`,
        payment_reference: String(p.reference || ""),
      });
      await notifyCustomerEvent(sql, tenantId, ispName, customerId, "service.restored", `${payId}-restore`, {
        customer_name: "",
        payment_reference: String(p.reference || ""),
        service_name: "Internet",
      });
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
    };
    const radius = await syncRadiusAccount(sql, event.tenantId, service);
    await enqueueServiceCommand(sql, event.tenantId, {
      ...service,
      username: radius.username,
      password: radius.password,
    });
  });
}
