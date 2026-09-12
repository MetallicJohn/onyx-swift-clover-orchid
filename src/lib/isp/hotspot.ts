import { nid } from "../utils.ts";
import { enqueueAgentCommand } from "./agent";
import { allocateAccountNumber } from "./account-numbers";
import { emit } from "./events";
import { activateVoucherClock, canActivate, canRevoke, nextVoucherStatus } from "./voucher-lifecycle";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

async function walkInCustomer(sql: Sql, tenantId: string) {
  const [c] = await sql<{ id: string }>`
    select id from customers where tenant_id = ${tenantId} and name = 'Hotspot walk-in'`;
  if (c) return c.id;
  const id = nid("cus");
  const accountNumber = await allocateAccountNumber(sql, tenantId);
  await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status, account_number)
    values (${id}, ${tenantId}, 'individual', 'Hotspot walk-in', '', '', '', 'active', ${accountNumber})`;
  return id;
}

export async function generateVouchers(
  sql: Sql,
  tenantId: string,
  packageId: string,
  count: number,
  hours: number,
) {
  const [pkg] = await sql<{ id: string }>`
    select id from packages where id = ${packageId} and tenant_id = ${tenantId} and access_method = 'hotspot'`;
  if (!pkg) throw new Error("Hotspot package not found");
  const n = Math.min(Math.max(count, 1), 50);
  const codes: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const code = `HS-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    await sql`insert into hotspot_vouchers (id, tenant_id, package_id, code, hours, status)
      values (${nid("vch")}, ${tenantId}, ${pkg.id}, ${code}, ${hours || 24}, 'unused')`;
    codes.push(code);
  }
  return { codes };
}

export async function expireDueVouchers(sql: Sql, tenantId: string) {
  const due = await sql<{ id: string; service_id: string | null; code: string; status: string; expires_at: string | null }>`
    select id, service_id, code, status, expires_at::text as expires_at from hotspot_vouchers
    where tenant_id = ${tenantId} and status = 'active'`;
  let n = 0;
  for (const v of due) {
    const next = nextVoucherStatus("active", v.expires_at ? new Date(v.expires_at) : null);
    if (next !== "expired") continue;
    await sql`update hotspot_vouchers set status = 'expired' where id = ${v.id}`;
    if (v.service_id) {
      await sql`update services set status = 'terminated' where id = ${v.service_id} and tenant_id = ${tenantId}`;
      await emit(sql, {
        type: "service.changed",
        tenantId,
        payload: { id: v.service_id, access_method: "hotspot", username: v.code, static_ip: null, status: "terminated" },
      });
    }
    n += 1;
  }
  return { expired: n };
}

export async function activateVoucher(sql: Sql, tenantId: string, voucherId: string, customerId?: string) {
  const [v] = await sql<{
    id: string;
    code: string;
    hours: number;
    status: string;
    package_id: string;
  }>`select id, code, hours, status, package_id from hotspot_vouchers
     where id = ${voucherId} and tenant_id = ${tenantId}`;
  if (!v) throw new Error("Voucher not found");
  if (!canActivate(v.status as "unused")) throw new Error("Voucher is not unused");
  const cid = customerId || (await walkInCustomer(sql, tenantId));
  const clock = activateVoucherClock(v.hours);
  const serviceId = nid("svc");
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end)
    values (${serviceId}, ${tenantId}, ${cid}, ${v.package_id}, 'hotspot', ${v.code}, null, 'active', ${clock.expires_at.toISOString()})`;
  await sql`update hotspot_vouchers
    set status = 'active', used_at = ${clock.used_at.toISOString()}, expires_at = ${clock.expires_at.toISOString()},
        service_id = ${serviceId}, customer_id = ${cid}
    where id = ${v.id}`;
  await emit(sql, {
    type: "service.changed",
    tenantId,
    payload: { id: serviceId, access_method: "hotspot", username: v.code, static_ip: null, status: "active" },
  });
  return { code: v.code, expires_at: clock.expires_at.toISOString(), service_id: serviceId };
}

export async function revokeVoucher(sql: Sql, tenantId: string, voucherId: string) {
  const [v] = await sql<{ id: string; status: string; service_id: string | null; code: string }>`
    select id, status, service_id, code from hotspot_vouchers where id = ${voucherId} and tenant_id = ${tenantId}`;
  if (!v) throw new Error("Voucher not found");
  if (!canRevoke(v.status as "unused")) throw new Error("Voucher cannot be revoked");
  await sql`update hotspot_vouchers set status = 'cancelled' where id = ${v.id}`;
  if (v.service_id) {
    await sql`update services set status = 'terminated' where id = ${v.service_id} and tenant_id = ${tenantId}`;
    await emit(sql, {
      type: "service.changed",
      tenantId,
      payload: { id: v.service_id, access_method: "hotspot", username: v.code, static_ip: null, status: "terminated" },
    });
  } else {
    await enqueueAgentCommand(sql, tenantId, "hotspot.disable", { username: v.code, status: "terminated" });
  }
  return { ok: true };
}
