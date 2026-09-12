import { nid } from "../utils.ts";
import { isKenyaMobile, normalizePhone } from "./phone.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const TRIAL_USED_MESSAGE =
  "This email or phone already used a free trial. Choose a paid plan in Settings → Plan.";

export type TrialIdentity = { email?: string | null; phone?: string | null; userId?: string | null };

export function normalizeEmail(raw: string) {
  return (raw || "").trim().toLowerCase();
}

export function assertSignupPhone(raw: string) {
  const phone = normalizePhone(raw);
  if (!isKenyaMobile(phone)) throw new Error("Enter a Kenyan mobile number (07… or 01…)");
  return phone;
}

function keysOf(identity: TrialIdentity) {
  const keys: { kind: "email" | "phone"; value: string }[] = [];
  const email = normalizeEmail(identity.email || "");
  if (email.includes("@")) keys.push({ kind: "email", value: email });
  const phone = normalizePhone(identity.phone || "");
  if (isKenyaMobile(phone)) keys.push({ kind: "phone", value: phone });
  return keys;
}

export async function tenantTrialIdentity(sql: Sql, tenantId: string): Promise<TrialIdentity> {
  const [row] = await sql<{ email: string; phone: string; user_id: string }>`
    select coalesce(u.email, t.support_email, '') as email,
           coalesce(t.support_phone, '') as phone,
           coalesce(m.user_id, '') as user_id
    from tenants t
    left join tenant_members m on m.tenant_id = t.id and m.role = 'isp_owner'
    left join "user" u on u.id = m.user_id
    where t.id = ${tenantId}
    limit 1`;
  return { email: row?.email || "", phone: row?.phone || "", userId: row?.user_id || "" };
}

export async function trialAlreadyUsed(sql: Sql, identity: TrialIdentity) {
  const keys = keysOf(identity);
  if (!keys.length) return false;
  for (const key of keys) {
    const [hit] = await sql<{ id: string }>`
      select id from saas_trial_claims where kind = ${key.kind} and value = ${key.value} limit 1`;
    if (hit) return true;
  }
  return false;
}

export async function recordTrialClaims(
  sql: Sql,
  opts: TrialIdentity & { tenantId: string },
) {
  const userId = opts.userId || "";
  for (const key of keysOf(opts)) {
    await sql`
      insert into saas_trial_claims (id, kind, value, tenant_id, user_id)
      values (${nid("trc")}, ${key.kind}, ${key.value}, ${opts.tenantId}, ${userId})
      on conflict (kind, value) do nothing`;
  }
}
