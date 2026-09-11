import { nid } from "../utils.ts";
import { deliverSms, getMessagingSettings } from "./messaging.ts";
import { writeInbox } from "./inbox.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type CustomerTag = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  customer_count: number;
};

export type AssignedTag = { id: string; name: string; enabled: boolean };

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export function normalizeTagName(raw: string) {
  const name = raw.trim();
  if (!name) throw new Error("Enter a tag name");
  if (/\s/.test(name)) throw new Error("Use one word — no spaces");
  if (!NAME_RE.test(name)) throw new Error("Use letters, numbers, hyphen, or underscore");
  return name;
}

export function tagSlug(name: string) {
  return normalizeTagName(name).toLowerCase();
}

export async function listTags(sql: Sql, tenantId: string): Promise<CustomerTag[]> {
  return sql<CustomerTag>`
    select t.id, t.name, t.slug, t.enabled,
      (select count(*)::int from customer_tag_assignments a where a.tag_id = t.id and a.tenant_id = t.tenant_id) as customer_count
    from customer_tags t
    where t.tenant_id = ${tenantId}
    order by t.name`;
}

export async function createTag(sql: Sql, tenantId: string, rawName: string): Promise<CustomerTag> {
  const name = normalizeTagName(rawName);
  const slug = tagSlug(name);
  const existing = await sql<{ id: string }>`
    select id from customer_tags where tenant_id = ${tenantId} and slug = ${slug}`;
  if (existing[0]) throw new Error("That tag already exists");
  const id = nid("tag");
  await sql`insert into customer_tags (id, tenant_id, name, slug, enabled)
    values (${id}, ${tenantId}, ${name}, ${slug}, true)`;
  return { id, name, slug, enabled: true, customer_count: 0 };
}

export async function renameTag(sql: Sql, tenantId: string, id: string, rawName: string): Promise<CustomerTag> {
  const name = normalizeTagName(rawName);
  const slug = tagSlug(name);
  const clash = await sql<{ id: string }>`
    select id from customer_tags where tenant_id = ${tenantId} and slug = ${slug} and id <> ${id}`;
  if (clash[0]) throw new Error("That tag already exists");
  const rows = await sql<{ id: string }>`
    update customer_tags set name = ${name}, slug = ${slug}
    where id = ${id} and tenant_id = ${tenantId}
    returning id`;
  if (!rows[0]) throw new Error("Tag not found");
  const found = (await listTags(sql, tenantId)).find((t) => t.id === id);
  if (!found) throw new Error("Tag not found");
  return found;
}

export async function setTagEnabled(sql: Sql, tenantId: string, id: string, enabled: boolean) {
  const rows = await sql<{ id: string }>`
    update customer_tags set enabled = ${enabled}
    where id = ${id} and tenant_id = ${tenantId}
    returning id`;
  if (!rows[0]) throw new Error("Tag not found");
}

export async function deleteTag(sql: Sql, tenantId: string, id: string) {
  const rows = await sql<{ id: string }>`
    delete from customer_tags where id = ${id} and tenant_id = ${tenantId} returning id`;
  if (!rows[0]) throw new Error("Tag not found");
}

export async function loadAssignments(sql: Sql, tenantId: string) {
  return sql<{ customer_id: string; id: string; name: string; enabled: boolean }>`
    select a.customer_id, t.id, t.name, t.enabled
    from customer_tag_assignments a
    join customer_tags t on t.id = a.tag_id
    where a.tenant_id = ${tenantId}
    order by t.name`;
}

async function assertOwnedCustomers(sql: Sql, tenantId: string, customerIds: string[]) {
  const unique = [...new Set(customerIds.filter(Boolean))];
  if (!unique.length) return unique;
  const found: string[] = [];
  for (const id of unique) {
    const rows = await sql<{ id: string }>`
      select id from customers where id = ${id} and tenant_id = ${tenantId}`;
    if (rows[0]) found.push(id);
  }
  if (found.length !== unique.length) throw new Error("Customer not found");
  return found;
}

async function assertOwnedTags(sql: Sql, tenantId: string, tagIds: string[], requireEnabled = false) {
  const unique = [...new Set(tagIds.filter(Boolean))];
  if (!unique.length) return unique;
  const found: { id: string; enabled: boolean }[] = [];
  for (const id of unique) {
    const rows = await sql<{ id: string; enabled: boolean }>`
      select id, enabled from customer_tags where id = ${id} and tenant_id = ${tenantId}`;
    if (rows[0]) found.push(rows[0]);
  }
  if (found.length !== unique.length) throw new Error("Tag not found");
  if (requireEnabled && found.some((t) => !t.enabled)) throw new Error("That tag is disabled");
  return unique;
}

export async function setCustomerTags(sql: Sql, tenantId: string, customerId: string, tagIds: string[]) {
  const [customer] = await assertOwnedCustomers(sql, tenantId, [customerId]);
  const tags = tagIds.length ? await assertOwnedTags(sql, tenantId, tagIds, true) : [];
  await sql`delete from customer_tag_assignments where tenant_id = ${tenantId} and customer_id = ${customer}`;
  for (const tagId of tags) {
    await sql`insert into customer_tag_assignments (tenant_id, customer_id, tag_id)
      values (${tenantId}, ${customer}, ${tagId})`;
  }
}

export async function bulkAssignTags(
  sql: Sql,
  tenantId: string,
  customerIds: string[],
  tagIds: string[],
  op: "add" | "remove",
) {
  const customers = await assertOwnedCustomers(sql, tenantId, customerIds);
  const tags = await assertOwnedTags(sql, tenantId, tagIds, op === "add");
  let changed = 0;
  for (const customerId of customers) {
    for (const tagId of tags) {
      if (op === "remove") {
        const rows = await sql<{ tag_id: string }>`
          delete from customer_tag_assignments
          where tenant_id = ${tenantId} and customer_id = ${customerId} and tag_id = ${tagId}
          returning tag_id`;
        if (rows[0]) changed += 1;
      } else {
        const rows = await sql<{ tag_id: string }>`
          insert into customer_tag_assignments (tenant_id, customer_id, tag_id)
          values (${tenantId}, ${customerId}, ${tagId})
          on conflict do nothing
          returning tag_id`;
        if (rows[0]) changed += 1;
      }
    }
  }
  return { customers: customers.length, tags: tags.length, changed };
}

export async function broadcastToCustomers(
  sql: Sql,
  opts: {
    tenantId: string;
    customerIds: string[];
    channels: Array<"sms" | "in_app">;
    subject: string;
    body: string;
  },
) {
  const subject = opts.subject.trim().slice(0, 200);
  const body = opts.body.trim().slice(0, 4000);
  if (!body) throw new Error("Enter a message");
  if (!opts.channels.length) throw new Error("Choose SMS or a notification");
  const customers = await assertOwnedCustomers(sql, opts.tenantId, opts.customerIds);
  if (customers.length > 500) throw new Error("Select up to 500 customers at a time");
  const rows = [];
  for (const id of customers) {
    const [c] = await sql<{ id: string; name: string; phone: string }>`
      select id, name, phone from customers where id = ${id} and tenant_id = ${opts.tenantId}`;
    if (c) rows.push(c);
  }
  const settings = await getMessagingSettings(sql, opts.tenantId);
  let sms = 0;
  let inbox = 0;
  let failed = 0;
  for (const c of rows) {
    if (opts.channels.includes("sms")) {
      const delivery = await deliverSms(settings, c.phone, body);
      const entityId = nid("msg");
      await sql`insert into notification_logs (id, tenant_id, customer_id, event_code, channel, entity_id, subject, body, destination, status)
        values (${nid("ntf")}, ${opts.tenantId}, ${c.id}, 'staff.sms', 'sms', ${entityId}, ${subject || "SMS"}, ${body}, ${delivery.detail}, ${delivery.status})`;
      if (delivery.status === "failed") failed += 1;
      else sms += 1;
    }
    if (opts.channels.includes("in_app")) {
      await writeInbox(sql, opts.tenantId, c.id, subject || "Message from your ISP", body, "staff.message");
      const entityId = nid("msg");
      await sql`insert into notification_logs (id, tenant_id, customer_id, event_code, channel, entity_id, subject, body, destination, status)
        values (${nid("ntf")}, ${opts.tenantId}, ${c.id}, 'staff.message', 'in_app', ${entityId}, ${subject || "Message from your ISP"}, ${body}, 'inbox', 'sent')`;
      inbox += 1;
    }
  }
  return { customers: rows.length, sms, inbox, failed };
}

export function customerHasTags(assigned: string[], selected: string[], mode: "any" | "all") {
  if (!selected.length) return true;
  if (mode === "all") return selected.every((id) => assigned.includes(id));
  return selected.some((id) => assigned.includes(id));
}

export function groupAssignments(rows: Array<AssignedTag & { customer_id: string }>) {
  const map = new Map<string, AssignedTag[]>();
  for (const row of rows) {
    const list = map.get(row.customer_id) ?? [];
    list.push({ id: row.id, name: row.name, enabled: row.enabled });
    map.set(row.customer_id, list);
  }
  return map;
}
