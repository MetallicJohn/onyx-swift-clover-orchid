import { nid } from "../utils.ts";
import { resolveAccountNumber } from "./document-format.ts";
import { e164, deliverSms, getMessagingSettings } from "./messaging.ts";
import {
  type AudienceFilter,
  type CommCategory,
  type CommExtras,
  type CommVars,
  DEFAULT_COMM_TEMPLATES,
  filterSignature,
  renderCommTemplate,
  smsSegments,
} from "./comms-format.ts";

export type { CommExtras };

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type AudienceRow = {
  customer_id: string;
  name: string;
  phone: string;
  address: string;
  type: string;
  created_at: string;
  account_number?: string;
  service_status: string;
  access_method: string;
  package_id: string;
  package_name: string;
  period_end: string | null;
  balance_kes: number;
  phone_ok: boolean;
};

const BATCH = 40;
const MAX_TICK = 200;

export function phoneOk(phone: string) {
  const n = e164(phone);
  return Boolean(n && n.replace(/\D/g, "").length >= 9);
}

function lineStatus(status: string, periodEnd: string | null, now: number) {
  if (status === "grace") return "grace" as const;
  if (status === "active") return "active" as const;
  if (periodEnd && Date.parse(periodEnd) < now) return "expired" as const;
  if (status === "suspended") return "suspended" as const;
  return status;
}

export async function ensureCommTemplates(sql: Sql, tenantId: string) {
  const existing = await sql<{ n: number }>`select count(*)::int as n from comm_templates where tenant_id = ${tenantId}`;
  if ((existing[0]?.n ?? 0) > 0) return;
  for (const t of DEFAULT_COMM_TEMPLATES) {
    await sql`insert into comm_templates (id, tenant_id, category, name, body, enabled)
      values (${nid("ctpl")}, ${tenantId}, ${t.category}, ${t.name}, ${t.body}, true)`;
  }
}

export async function listCommTemplates(sql: Sql, tenantId: string, category?: string) {
  await ensureCommTemplates(sql, tenantId);
  if (category) {
    return sql<{ id: string; category: string; name: string; body: string; enabled: boolean }>`
      select id, category, name, body, enabled from comm_templates
      where tenant_id = ${tenantId} and category = ${category}
      order by name`;
  }
  return sql<{ id: string; category: string; name: string; body: string; enabled: boolean }>`
    select id, category, name, body, enabled from comm_templates
    where tenant_id = ${tenantId}
    order by category, name`;
}

export async function saveCommTemplate(
  sql: Sql,
  tenantId: string,
  data: { id?: string; category: CommCategory; name: string; body: string; enabled?: boolean },
) {
  const name = data.name.trim();
  const body = data.body.trim();
  if (!name) throw new Error("Enter a template name");
  if (!body) throw new Error("Enter a message");
  if (data.id) {
    const rows = await sql<{ id: string }>`
      update comm_templates
      set name = ${name}, body = ${body}, category = ${data.category}, enabled = ${data.enabled ?? true}
      where id = ${data.id} and tenant_id = ${tenantId}
      returning id`;
    if (!rows[0]) throw new Error("Template not found");
    return data.id;
  }
  const id = nid("ctpl");
  await sql`insert into comm_templates (id, tenant_id, category, name, body, enabled)
    values (${id}, ${tenantId}, ${data.category}, ${name}, ${body}, ${data.enabled ?? true})`;
  return id;
}

export async function deleteCommTemplate(sql: Sql, tenantId: string, id: string) {
  const rows = await sql<{ id: string }>`
    delete from comm_templates where id = ${id} and tenant_id = ${tenantId} returning id`;
  if (!rows[0]) throw new Error("Template not found");
}

export async function audienceOptions(sql: Sql, tenantId: string) {
  const packages = await sql<{ id: string; name: string; access_method: string }>`
    select id, name, access_method from packages where tenant_id = ${tenantId} and active = true order by name`;
  const areas = await sql<{ address: string; n: number }>`
    select address, count(*)::int as n from customers
    where tenant_id = ${tenantId} and address <> ''
    group by address order by n desc, address limit 80`;
  const types = await sql<{ type: string; n: number }>`
    select type, count(*)::int as n from customers where tenant_id = ${tenantId} group by type order by type`;
  const tags = await sql<{ id: string; name: string; enabled: boolean }>`
    select id, name, enabled from customer_tags where tenant_id = ${tenantId} order by name`;
  return {
    packages,
    areas: areas.map((a) => ({ name: a.address, n: a.n })),
    types,
    tags,
  };
}

export async function resolveAudience(sql: Sql, tenantId: string, filter: AudienceFilter): Promise<AudienceRow[]> {
  const customers = await sql<{
    id: string;
    name: string;
    phone: string;
    address: string;
    type: string;
    created_at: string;
    account_number: string;
  }>`select id, name, phone, address, type, created_at::text as created_at, coalesce(account_number,'') as account_number from customers where tenant_id = ${tenantId}`;
  const services = await sql<{
    customer_id: string;
    status: string;
    access_method: string;
    package_id: string;
    package_name: string;
    period_end: string | null;
  }>`
    select s.customer_id, s.status, s.access_method, s.package_id, p.name as package_name, s.period_end::text as period_end
    from services s
    join packages p on p.id = s.package_id
    where s.tenant_id = ${tenantId}`;
  const balances = await sql<{ customer_id: string; balance_kes: number }>`
    select customer_id, coalesce(sum(greatest(0, amount_kes - paid_kes)),0)::int as balance_kes
    from invoices
    where tenant_id = ${tenantId} and status in ('due','overdue','issued','partial')
    group by customer_id`;
  const bal = new Map(balances.map((b) => [b.customer_id, b.balance_kes]));
  const tagRows = filter.tag_ids?.length
    ? await sql<{ customer_id: string; tag_id: string }>`
        select customer_id, tag_id from customer_tag_assignments where tenant_id = ${tenantId}`
    : [];
  const tagsByCustomer = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByCustomer.get(t.customer_id) ?? [];
    list.push(t.tag_id);
    tagsByCustomer.set(t.customer_id, list);
  }
  const svcByCustomer = new Map<string, typeof services>();
  for (const s of services) {
    const list = svcByCustomer.get(s.customer_id) ?? [];
    list.push(s);
    svcByCustomer.set(s.customer_id, list);
  }
  const now = Date.now();
  const area = (filter.area ?? "").trim().toLowerCase();
  const out: AudienceRow[] = [];
  for (const c of customers) {
    if (filter.types?.length && !filter.types.includes(c.type)) continue;
    if (area && !c.address.toLowerCase().includes(area)) continue;
    const created = Date.parse(c.created_at);
    if (filter.new_days && !(Number.isFinite(created) && now - created <= filter.new_days * 86400_000)) continue;
    if (filter.long_term_days && !(Number.isFinite(created) && now - created >= filter.long_term_days * 86400_000)) continue;
    const balance = bal.get(c.id) ?? 0;
    if (filter.overdue && balance <= 0) continue;
    if (filter.tag_ids?.length) {
      const have = tagsByCustomer.get(c.id) ?? [];
      if (!filter.tag_ids.every((id) => have.includes(id))) continue;
    }
    const lines = svcByCustomer.get(c.id) ?? [];
    const match = lines.find((s) => {
      const st = lineStatus(s.status, s.period_end, now);
      if (filter.statuses?.length && !filter.statuses.includes(st as "active" | "suspended" | "expired" | "grace")) return false;
      if (filter.access?.length && !filter.access.includes(s.access_method as "pppoe" | "static" | "hotspot")) return false;
      if (filter.package_ids?.length && !filter.package_ids.includes(s.package_id)) return false;
      if (filter.expiring_days) {
        if (!s.period_end) return false;
        const end = Date.parse(s.period_end);
        if (!Number.isFinite(end) || end < now || end > now + filter.expiring_days * 86400_000) return false;
      }
      return true;
    });
    if (!match && (filter.statuses?.length || filter.access?.length || filter.package_ids?.length || filter.expiring_days)) continue;
    if (!match && !lines.length && (filter.statuses?.length || filter.access?.length || filter.package_ids?.length)) continue;
    const use = match ?? lines[0];
    out.push({
      customer_id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      type: c.type,
      created_at: c.created_at,
      account_number: c.account_number,
      service_status: use ? lineStatus(use.status, use.period_end, now) : "none",
      access_method: use?.access_method ?? "",
      package_id: use?.package_id ?? "",
      package_name: use?.package_name ?? "",
      period_end: use?.period_end ?? null,
      balance_kes: balance,
      phone_ok: phoneOk(c.phone),
    });
  }
  return out;
}

export function summarizeAudience(rows: AudienceRow[]) {
  const valid = rows.filter((r) => r.phone_ok);
  return { total: rows.length, valid: valid.length, skipped: rows.length - valid.length };
}

function campaignVars(
  row: AudienceRow,
  extras: CommExtras,
  ctx: { slug: string; company: string; support: string },
): CommVars {
  return {
    customer_name: row.name,
    account_number: resolveAccountNumber(ctx.slug, row.customer_id, row.account_number),
    service_name: row.package_name || row.access_method,
    package_name: row.package_name,
    service_expiry: row.period_end ? row.period_end.slice(0, 10) : "",
    maintenance_date: extras.maintenance_date ?? "",
    maintenance_start: extras.maintenance_start ?? "",
    maintenance_end: extras.maintenance_end ?? "",
    expected_duration: extras.expected_duration ?? "",
    expected_time: extras.expected_time ?? "",
    area: extras.area || row.address,
    support_contact: ctx.support,
    company_name: ctx.company,
  };
}

export async function recentDuplicate(
  sql: Sql,
  tenantId: string,
  category: string,
  body: string,
  filter: AudienceFilter,
) {
  const sig = filterSignature(filter);
  const rows = await sql<{ id: string; created_at: string; created_by_label: string }>`
    select id, created_at::text as created_at, created_by_label from comm_campaigns
    where tenant_id = ${tenantId} and category = ${category} and body = ${body} and filter_json = ${sig}
      and created_at > now() - interval '30 minutes'
    order by created_at desc limit 1`;
  return rows[0] ?? null;
}

export async function createCampaign(
  sql: Sql,
  opts: {
    tenantId: string;
    slug: string;
    company: string;
    support: string;
    category: CommCategory;
    name?: string;
    body: string;
    templateId?: string;
    filter: AudienceFilter;
    extras?: CommExtras;
    actorId: string;
    actorLabel: string;
    restoreOf?: string;
  },
) {
  const body = opts.body.trim();
  if (!body) throw new Error("Enter a message");
  const audience = await resolveAudience(sql, opts.tenantId, opts.filter);
  const summary = summarizeAudience(audience);
  const settings = await getMessagingSettings(sql, opts.tenantId);
  const sample = audience[0];
  const rendered = sample
    ? renderCommTemplate(body, campaignVars(sample, opts.extras ?? {}, { slug: opts.slug, company: opts.company, support: opts.support }))
    : body;
  const parts = smsSegments(rendered).parts || 1;
  const id = nid("cmp");
  const filterJson = filterSignature(opts.filter);
  const extrasJson = JSON.stringify(opts.extras ?? {});
  await sql`insert into comm_campaigns (
      id, tenant_id, name, category, body, template_id, filter_json, extras_json, sender_id, provider,
      created_by, created_by_label, status, recipient_count, valid_count, skipped_count, sms_parts, sms_count
    ) values (
      ${id}, ${opts.tenantId}, ${opts.name || ""}, ${opts.category}, ${body}, ${opts.templateId || null},
      ${filterJson}, ${extrasJson}, ${settings.sms_sender_id}, ${settings.sms_provider},
      ${opts.actorId}, ${opts.actorLabel}, 'queued', ${summary.total}, ${summary.valid}, ${summary.skipped},
      ${parts}, ${summary.valid * parts}
    )`;
  if (opts.restoreOf) {
    await sql`update comm_campaigns set restore_of = ${opts.restoreOf} where id = ${id} and tenant_id = ${opts.tenantId}`;
  }
  const ctx = { slug: opts.slug, company: opts.company, support: opts.support };
  for (const row of audience) {
    const rid = nid("crcp");
    if (!row.phone_ok) {
      await sql`insert into comm_recipients (id, tenant_id, campaign_id, customer_id, phone, body, status, detail, sms_parts)
        values (${rid}, ${opts.tenantId}, ${id}, ${row.customer_id}, ${row.phone}, ${body}, 'skipped', 'No valid mobile number', 0)`;
      continue;
    }
    const text = renderCommTemplate(body, campaignVars(row, opts.extras ?? {}, ctx));
    const seg = smsSegments(text);
    await sql`insert into comm_recipients (id, tenant_id, campaign_id, customer_id, phone, body, status, detail, sms_parts)
      values (${rid}, ${opts.tenantId}, ${id}, ${row.customer_id}, ${e164(row.phone)}, ${text}, 'queued', '', ${seg.parts})`;
  }
  return { id, ...summary, sms_parts: parts, sms_count: summary.valid * parts };
}

export async function dispatchCampaign(sql: Sql, tenantId: string, campaignId: string) {
  const [camp] = await sql<{ id: string; status: string }>`
    select id, status from comm_campaigns where id = ${campaignId} and tenant_id = ${tenantId}`;
  if (!camp) throw new Error("Campaign not found");
  if (camp.status === "sent") return loadCampaign(sql, tenantId, campaignId);
  await sql`update comm_campaigns set status = 'sending' where id = ${campaignId} and tenant_id = ${tenantId} and status in ('queued','sending')`;
  const settings = await getMessagingSettings(sql, tenantId);
  let processed = 0;
  while (processed < MAX_TICK) {
    const batch = await sql<{ id: string; phone: string; body: string; customer_id: string }>`
      select id, phone, body, customer_id from comm_recipients
      where campaign_id = ${campaignId} and tenant_id = ${tenantId} and status = 'queued'
      order by id limit ${BATCH}`;
    if (!batch.length) break;
    for (const row of batch) {
      const claimed = await sql<{ id: string }>`
        update comm_recipients set status = 'sent', detail = 'sending'
        where id = ${row.id} and tenant_id = ${tenantId} and status = 'queued'
        returning id`;
      if (!claimed[0]) continue;
      const delivery = await deliverSms(settings, row.phone, row.body);
      if (delivery.status === "failed") {
        await sql`update comm_recipients set status = 'failed', detail = ${delivery.detail}, sent_at = now()
          where id = ${row.id} and tenant_id = ${tenantId}`;
      } else {
        await sql`update comm_recipients set status = 'sent', detail = ${delivery.detail}, sent_at = now()
          where id = ${row.id} and tenant_id = ${tenantId}`;
        await sql`insert into notification_logs (id, tenant_id, customer_id, event_code, channel, entity_id, subject, body, destination, status)
          values (${nid("ntf")}, ${tenantId}, ${row.customer_id}, 'staff.campaign', 'sms', ${row.id}, 'Campaign', ${row.body}, ${delivery.detail}, ${delivery.status})`;
      }
      processed += 1;
    }
  }
  const counts = await sql<{ status: string; n: number }>`
    select status, count(*)::int as n from comm_recipients where campaign_id = ${campaignId} and tenant_id = ${tenantId} group by status`;
  const by = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const queued = by.queued ?? 0;
  const failed = by.failed ?? 0;
  const sent = by.sent ?? 0;
  const status = queued > 0 ? "sending" : sent === 0 && failed > 0 ? "failed" : "sent";
  await sql`update comm_campaigns
    set status = ${status}, sent_count = ${sent}, failed_count = ${failed}, sent_at = case when ${status} = 'sent' then now() else sent_at end
    where id = ${campaignId} and tenant_id = ${tenantId}`;
  return loadCampaign(sql, tenantId, campaignId);
}

export async function dispatchPendingCampaigns(sql: Sql, tenantId: string) {
  const rows = await sql<{ id: string }>`
    select id from comm_campaigns where tenant_id = ${tenantId} and status in ('queued','sending') order by created_at limit 5`;
  const out = [];
  for (const row of rows) out.push(await dispatchCampaign(sql, tenantId, row.id));
  return out;
}

export async function loadCampaign(sql: Sql, tenantId: string, id: string) {
  const [camp] = await sql<{
    id: string;
    name: string;
    category: string;
    body: string;
    template_id: string | null;
    filter_json: string;
    extras_json: string;
    sender_id: string;
    provider: string;
    created_by: string;
    created_by_label: string;
    status: string;
    recipient_count: number;
    valid_count: number;
    skipped_count: number;
    sms_parts: number;
    sms_count: number;
    sent_count: number;
    failed_count: number;
    restore_of: string | null;
    created_at: string;
    sent_at: string | null;
  }>`
    select id, name, category, body, template_id, filter_json, extras_json, sender_id, provider, created_by, created_by_label,
           status, recipient_count, valid_count, skipped_count, sms_parts, sms_count, sent_count, failed_count, restore_of,
           created_at::text as created_at, sent_at::text as sent_at
    from comm_campaigns where id = ${id} and tenant_id = ${tenantId}`;
  if (!camp) throw new Error("Campaign not found");
  return camp;
}

export async function listCampaigns(sql: Sql, tenantId: string) {
  return sql<{
    id: string;
    name: string;
    category: string;
    status: string;
    recipient_count: number;
    valid_count: number;
    skipped_count: number;
    sms_count: number;
    sent_count: number;
    failed_count: number;
    created_by_label: string;
    sender_id: string;
    created_at: string;
    restore_of: string | null;
  }>`
    select id, name, category, status, recipient_count, valid_count, skipped_count, sms_count, sent_count, failed_count,
           created_by_label, sender_id, created_at::text as created_at, restore_of
    from comm_campaigns where tenant_id = ${tenantId}
    order by created_at desc limit 100`;
}

export async function listCampaignRecipients(
  sql: Sql,
  tenantId: string,
  campaignId: string,
  opts?: { status?: string; page?: number; pageSize?: number },
) {
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts?.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const status = opts?.status ?? "";
  const rows = status
    ? await sql<{
        id: string;
        customer_id: string;
        phone: string;
        body: string;
        status: string;
        detail: string;
        sms_parts: number;
        name: string;
      }>`
        select r.id, r.customer_id, r.phone, r.body, r.status, r.detail, r.sms_parts, c.name
        from comm_recipients r join customers c on c.id = r.customer_id
        where r.tenant_id = ${tenantId} and r.campaign_id = ${campaignId} and r.status = ${status}
        order by c.name limit ${pageSize} offset ${offset}`
    : await sql<{
        id: string;
        customer_id: string;
        phone: string;
        body: string;
        status: string;
        detail: string;
        sms_parts: number;
        name: string;
      }>`
        select r.id, r.customer_id, r.phone, r.body, r.status, r.detail, r.sms_parts, c.name
        from comm_recipients r join customers c on c.id = r.customer_id
        where r.tenant_id = ${tenantId} and r.campaign_id = ${campaignId}
        order by c.name limit ${pageSize} offset ${offset}`;
  const [n] = status
    ? await sql<{ n: number }>`
        select count(*)::int as n from comm_recipients
        where tenant_id = ${tenantId} and campaign_id = ${campaignId} and status = ${status}`
    : await sql<{ n: number }>`
        select count(*)::int as n from comm_recipients
        where tenant_id = ${tenantId} and campaign_id = ${campaignId}`;
  return { rows, total: n?.n ?? 0, page, pageSize };
}

export async function resendFailed(
  sql: Sql,
  tenantId: string,
  campaignId: string,
  actor: { id: string; label: string; slug: string; company: string; support: string },
) {
  const camp = await loadCampaign(sql, tenantId, campaignId);
  const failed = await sql<{ customer_id: string; phone: string; body: string; sms_parts: number }>`
    select customer_id, phone, body, sms_parts from comm_recipients
    where tenant_id = ${tenantId} and campaign_id = ${campaignId} and status = 'failed'`;
  if (!failed.length) throw new Error("No failed messages to resend");
  const settings = await getMessagingSettings(sql, tenantId);
  const parts = failed[0]?.sms_parts || 1;
  const id = nid("cmp");
  await sql`insert into comm_campaigns (
      id, tenant_id, name, category, body, template_id, filter_json, extras_json, sender_id, provider,
      created_by, created_by_label, status, recipient_count, valid_count, skipped_count, sms_parts, sms_count, restore_of
    ) values (
      ${id}, ${tenantId}, ${(camp.name || camp.category) + " (resend)"}, ${camp.category}, ${camp.body}, ${camp.template_id},
      ${camp.filter_json}, ${camp.extras_json}, ${settings.sms_sender_id}, ${settings.sms_provider},
      ${actor.id}, ${actor.label}, 'queued', ${failed.length}, ${failed.length}, 0, ${parts}, ${failed.length * parts}, ${campaignId}
    )`;
  for (const row of failed) {
    await sql`insert into comm_recipients (id, tenant_id, campaign_id, customer_id, phone, body, status, detail, sms_parts)
      values (${nid("crcp")}, ${tenantId}, ${id}, ${row.customer_id}, ${row.phone}, ${row.body}, 'queued', 'resend', ${row.sms_parts})`;
  }
  return dispatchCampaign(sql, tenantId, id);
}
