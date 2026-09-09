import { nid } from "../utils.ts";
import type { Sql } from "./events";

export async function awardLoyalty(
  sql: Sql,
  tenantId: string,
  customerId: string,
  amountKes: number,
  reason = "payment",
  refId = "",
) {
  if (!customerId) return 0;
  const points = Math.floor(amountKes / 10);
  if (points <= 0) return 0;
  const existing = await sql<{ id: string; points: number }>`
    select id, points from loyalty_accounts where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  if (existing[0]) {
    await sql`update loyalty_accounts set points = ${existing[0].points + points} where id = ${existing[0].id}`;
  } else {
    await sql`insert into loyalty_accounts (id, tenant_id, customer_id, points)
      values (${nid("loy")}, ${tenantId}, ${customerId}, ${points})`;
  }
  await sql`insert into loyalty_transactions (id, tenant_id, customer_id, delta, reason, ref_id)
    values (${nid("ltx")}, ${tenantId}, ${customerId}, ${points}, ${reason}, ${refId})`;
  return points;
}

export async function redeemLoyalty(sql: Sql, tenantId: string, customerId: string, points: number) {
  const n = Math.floor(points);
  if (n < 1) throw new Error("Points required");
  const [acc] = await sql<{ id: string; points: number }>`
    select id, points from loyalty_accounts where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  if (!acc || acc.points < n) throw new Error("Not enough points");
  await sql`update loyalty_accounts set points = ${acc.points - n} where id = ${acc.id}`;
  await sql`insert into loyalty_transactions (id, tenant_id, customer_id, delta, reason, ref_id)
    values (${nid("ltx")}, ${tenantId}, ${customerId}, ${-n}, 'redeem', '')`;
  return { points: acc.points - n };
}
