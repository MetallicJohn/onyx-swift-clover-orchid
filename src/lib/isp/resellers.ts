import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function creditReseller(
  sql: Sql,
  tenantId: string,
  customerId: string,
  amountKes: number,
  paymentId: string,
) {
  if (!customerId || amountKes <= 0) return null;
  const [cus] = await sql<{ reseller_id: string | null }>`
    select reseller_id from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  if (!cus?.reseller_id) return null;
  const [rs] = await sql<{ id: string; commission_pct: number; status: string }>`
    select id, commission_pct, status from resellers where id = ${cus.reseller_id} and tenant_id = ${tenantId}`;
  if (!rs || rs.status !== "active") return null;
  const commission = Math.floor((amountKes * rs.commission_pct) / 100);
  if (commission <= 0) return null;
  const [wallet] = await sql<{ id: string; balance_kes: number }>`
    select id, balance_kes from reseller_wallets where tenant_id = ${tenantId} and reseller_id = ${rs.id}`;
  if (wallet) {
    await sql`update reseller_wallets set balance_kes = ${wallet.balance_kes + commission} where id = ${wallet.id}`;
  } else {
    await sql`insert into reseller_wallets (id, tenant_id, reseller_id, balance_kes)
      values (${nid("rwl")}, ${tenantId}, ${rs.id}, ${commission})`;
  }
  await sql`insert into reseller_transactions (id, tenant_id, reseller_id, delta_kes, reason, ref_id)
    values (${nid("rtx")}, ${tenantId}, ${rs.id}, ${commission}, 'commission', ${paymentId})`;
  return { reseller_id: rs.id, commission };
}

export async function attachCustomerReseller(sql: Sql, tenantId: string, customerId: string, resellerId: string) {
  const [rs] = await sql<{ id: string }>`select id from resellers where id = ${resellerId} and tenant_id = ${tenantId}`;
  if (!rs) throw new Error("Reseller not found");
  await sql`update customers set reseller_id = ${rs.id} where id = ${customerId} and tenant_id = ${tenantId}`;
}
