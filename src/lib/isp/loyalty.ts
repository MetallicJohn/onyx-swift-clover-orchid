import { nid } from "@/lib/utils";
import type { Sql } from "./events";
import { ensureOpsSchema } from "./ops-schema";

export async function awardLoyalty(sql: Sql, tenantId: string, customerId: string, amountKes: number) {
  await ensureOpsSchema(sql);
  const points = Math.floor(amountKes / 10);
  const existing = await sql<{ id: string; points: number }>`
    select id, points from loyalty_accounts where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  if (existing[0]) {
    await sql`update loyalty_accounts set points = ${existing[0].points + points} where id = ${existing[0].id}`;
    return;
  }
  await sql`insert into loyalty_accounts (id, tenant_id, customer_id, points)
    values (${nid("loy")}, ${tenantId}, ${customerId}, ${points})`;
}
