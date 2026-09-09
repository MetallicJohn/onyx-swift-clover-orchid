import { nid } from "../utils.ts";
import { deliverSms, getMessagingSettings } from "./messaging";
import { applyRls } from "./rls";
import { newOtp } from "./otp";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function issueResellerOtp(sql: Sql, slug: string, phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9) throw new Error("Enter a valid phone number");
  await applyRls(sql, { bypass: true });
  const [ten] = await sql<{ id: string; name: string }>`select id, name from tenants where slug = ${slug.trim()}`;
  if (!ten) throw new Error("Unknown network");
  await applyRls(sql, { tenantId: ten.id, bypass: false });
  const rows = await sql<{ id: string; phone: string; name: string }>`
    select id, phone, name from resellers where tenant_id = ${ten.id} and status = 'active'`;
  const reseller = rows.find((r) => r.phone.replace(/\D/g, "").endsWith(digits.slice(-9)));
  if (!reseller) throw new Error("No reseller with that phone");
  const settings = await getMessagingSettings(sql, ten.id);
  const code = newOtp(settings.sms_sandbox);
  await sql`insert into reseller_otps (id, tenant_id, reseller_id, phone, code, expires_at, used)
    values (${nid("rot")}, ${ten.id}, ${reseller.id}, ${phone}, ${code}, now() + interval '15 minutes', false)`;
  if (!settings.sms_sandbox) {
    await deliverSms(settings, phone, `${ten.name} reseller code: ${code}`);
  }
  return { sent: true, hint: settings.sms_sandbox ? code : "sent to your phone", isp: ten.name };
}

export async function verifyResellerOtp(sql: Sql, slug: string, phone: string, code: string) {
  const digits = phone.replace(/\D/g, "");
  await applyRls(sql, { bypass: true });
  const [ten] = await sql<{ id: string }>`select id from tenants where slug = ${slug.trim()}`;
  if (!ten) throw new Error("Unknown network");
  await applyRls(sql, { tenantId: ten.id, bypass: false });
  const rows = await sql<{ id: string; reseller_id: string }>`
    select id, reseller_id from reseller_otps
    where tenant_id = ${ten.id} and code = ${code.trim()} and used = false and expires_at > now()`;
  const resellers = await sql<{ id: string; phone: string }>`select id, phone from resellers where tenant_id = ${ten.id}`;
  const match = rows.find((r) => {
    const rs = resellers.find((x) => x.id === r.reseller_id);
    return rs && rs.phone.replace(/\D/g, "").endsWith(digits.slice(-9));
  });
  if (!match) throw new Error("Invalid or expired code");
  await sql`update reseller_otps set used = true where id = ${match.id}`;
  const token = `rsl_${crypto.randomUUID().replace(/-/g, "")}`;
  await sql`insert into reseller_sessions (id, tenant_id, reseller_id, token)
    values (${nid("rss")}, ${ten.id}, ${match.reseller_id}, ${token})`;
  return { token };
}

export async function resellerHome(sql: Sql, token: string) {
  await applyRls(sql, { bypass: true });
  const [ses] = await sql<{ tenant_id: string; reseller_id: string }>`
    select tenant_id, reseller_id from reseller_sessions where token = ${token}`;
  if (!ses) throw new Error("Session expired. Sign in again.");
  await applyRls(sql, { tenantId: ses.tenant_id, bypass: false });
  const [isp] = await sql<{ name: string; slug: string }>`select name, slug from tenants where id = ${ses.tenant_id}`;
  const [rs] = await sql<{ name: string; phone: string; commission_pct: number }>`
    select name, phone, commission_pct from resellers where id = ${ses.reseller_id}`;
  const [wallet] = await sql<{ balance_kes: number }>`
    select balance_kes from reseller_wallets where tenant_id = ${ses.tenant_id} and reseller_id = ${ses.reseller_id}`;
  const customers = await sql<{ id: string; name: string; phone: string; status: string }>`
    select id, name, phone, status from customers
    where tenant_id = ${ses.tenant_id} and reseller_id = ${ses.reseller_id} order by name`;
  const txs = await sql<{ delta_kes: number; reason: string; created_at: string }>`
    select delta_kes, reason, created_at::text as created_at from reseller_transactions
    where tenant_id = ${ses.tenant_id} and reseller_id = ${ses.reseller_id}
    order by created_at desc limit 20`;
  if (!rs || !isp) throw new Error("Account not found");
  return { isp, reseller: rs, balance: wallet?.balance_kes ?? 0, customers, txs };
}
