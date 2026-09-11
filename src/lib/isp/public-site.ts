import { nid } from "../utils.ts";
import { rateLimit } from "./rate-limit.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const TOPICS = ["sales", "support", "partnership"] as const;
export type InquiryTopic = (typeof TOPICS)[number];

export function isInquiryTopic(value: string): value is InquiryTopic {
  return (TOPICS as readonly string[]).includes(value);
}

export async function publicSiteContact(sql: Sql) {
  const rows = await sql<{ key: string; value: string }>`
    select key, value from platform_settings
    where key in ('sales_email','support_email','contact_phone')`;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    sales_email: (map.sales_email || "").trim(),
    support_email: (map.support_email || "").trim(),
    contact_phone: (map.contact_phone || "").trim(),
  };
}

export async function submitInquiry(
  sql: Sql,
  opts: {
    name: string;
    company: string;
    email: string;
    phone: string;
    topic: string;
    message: string;
    website?: string;
    ip?: string;
  },
) {
  if ((opts.website || "").trim()) throw new Error("Could not send the message");
  const name = opts.name.trim();
  const email = opts.email.trim().toLowerCase();
  const message = opts.message.trim();
  const company = opts.company.trim();
  const phone = opts.phone.trim();
  if (name.length < 2 || name.length > 80) throw new Error("Enter your name");
  if (!email.includes("@") || email.length > 120) throw new Error("Enter a valid email");
  if (company.length > 80) throw new Error("Company name is too long");
  if (phone.length > 32) throw new Error("Phone is too long");
  if (!isInquiryTopic(opts.topic)) throw new Error("Choose a topic");
  if (message.length < 10 || message.length > 2000) throw new Error("Message should be 10–2000 characters");
  const ip = (opts.ip || "unknown").slice(0, 64);
  const limited = rateLimit(`inquiry:${ip}:${email}`, 5, 60 * 60_000);
  if (!limited.ok) throw new Error("Please wait before sending another message");
  await sql`insert into platform_inquiries (id, name, company, email, phone, topic, message)
    values (${nid("inq")}, ${name}, ${company}, ${email}, ${phone}, ${opts.topic}, ${message})`;
  return { ok: true as const };
}
