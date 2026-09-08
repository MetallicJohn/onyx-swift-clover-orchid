import { awardLoyalty } from "./loyalty";
import { normalizePhone } from "./phone";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function convertReferral(sql: Sql, tenantId: string, phone: string) {
  const p = normalizePhone(phone);
  if (!p) return null;
  const refs = await sql<{ id: string; referrer_id: string; points: number; referee_phone: string }>`
    select id, referrer_id, points, referee_phone from referrals
    where tenant_id = ${tenantId} and status = 'pending'`;
  const found = refs.find((r) => normalizePhone(r.referee_phone) === p);
  if (!found) return null;
  await sql`update referrals set status = 'converted' where id = ${found.id}`;
  await awardLoyalty(sql, tenantId, found.referrer_id, found.points * 10, "referral", found.id);
  return found;
}
