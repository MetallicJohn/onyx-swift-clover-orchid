import { nid } from "../utils.ts";
import { deliverSms, getMessagingSettings } from "./messaging";
import { newOtp } from "./otp";
import { applyRls } from "./rls";

export { newOtp } from "./otp";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function issuePortalOtp(sql: Sql, slug: string, phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 9) throw new Error("Enter a valid phone number");
  await applyRls(sql, { bypass: true });
  const [ten] = await sql<{ id: string; name: string }>`select id, name from tenants where slug = ${slug.trim()}`;
  if (!ten) throw new Error("Unknown network. Check the ISP slug.");
  await applyRls(sql, { tenantId: ten.id, bypass: false });
  const customers = await sql<{ id: string; phone: string }>`
    select id, phone from customers where tenant_id = ${ten.id}`;
  const customer = customers.find((c) => c.phone.replace(/\D/g, "").endsWith(digits.slice(-9)));
  if (!customer) throw new Error("No customer with that phone on this network");
  const settings = await getMessagingSettings(sql, ten.id);
  const code = newOtp(settings.sms_sandbox);
  const id = nid("otp");
  await sql`insert into portal_otps (id, tenant_id, customer_id, phone, code, expires_at, used)
    values (${id}, ${ten.id}, ${customer.id}, ${phone}, ${code}, now() + interval '15 minutes', false)`;
  if (!settings.sms_sandbox) {
    await deliverSms(settings, phone, `${ten.name} portal code: ${code}. Expires in 15 minutes.`);
  }
  return {
    sent: true,
    hint: settings.sms_sandbox ? code : "sent to your phone",
    isp: ten.name,
    sandbox: settings.sms_sandbox,
  };
}

export async function verifyPortalOtp(sql: Sql, slug: string, phone: string, code: string) {
  const digits = phone.replace(/\D/g, "");
  await applyRls(sql, { bypass: true });
  const [ten] = await sql<{ id: string; name: string }>`select id, name from tenants where slug = ${slug.trim()}`;
  if (!ten) throw new Error("Unknown network");
  await applyRls(sql, { tenantId: ten.id, bypass: false });
  const rows = await sql<{ id: string; customer_id: string }>`
    select id, customer_id from portal_otps
    where tenant_id = ${ten.id} and code = ${code.trim()} and used = false and expires_at > now()
    order by expires_at desc limit 8`;
  const customers = await sql<{ id: string; phone: string }>`select id, phone from customers where tenant_id = ${ten.id}`;
  const match = rows.find((r) => {
    const c = customers.find((x) => x.id === r.customer_id);
    return c && c.phone.replace(/\D/g, "").endsWith(digits.slice(-9));
  });
  if (!match) throw new Error("Invalid or expired code");
  await sql`update portal_otps set used = true where id = ${match.id}`;
  const token = `prt_${crypto.randomUUID().replace(/-/g, "")}`;
  await sql`insert into portal_sessions (id, tenant_id, customer_id, token)
    values (${nid("psn")}, ${ten.id}, ${match.customer_id}, ${token})`;
  return { token, tenantId: ten.id, customerId: match.customer_id, isp: ten.name };
}

export async function portalContext(sql: Sql, token: string) {
  await applyRls(sql, { bypass: true });
  const [ses] = await sql<{ tenant_id: string; customer_id: string }>`
    select tenant_id, customer_id from portal_sessions where token = ${token}`;
  if (!ses) throw new Error("Session expired. Sign in again.");
  await applyRls(sql, { tenantId: ses.tenant_id, bypass: false });
  const [isp] = await sql<{ name: string; slug: string; support_phone: string }>`
    select name, slug, support_phone from tenants where id = ${ses.tenant_id}`;
  const [customer] = await sql<{ id: string; name: string; phone: string; email: string }>`
    select id, name, phone, email from customers where id = ${ses.customer_id}`;
  if (!customer || !isp) throw new Error("Account not found");
  return { tenantId: ses.tenant_id, customer, isp };
}
