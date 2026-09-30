import { nid } from "../utils.ts";
import { last9Phone } from "./customer-portal-format.ts";
import {
  ACTIVITY_TYPES,
  CONTACT_METHODS,
  COVERAGE_STATUSES,
  DEFAULT_LEAD_SOURCES,
  INSTALL_STATUSES,
  LEAD_STATUSES,
  LEAD_TYPES,
  parseLatitude,
  parseLongitude,
  type CoverageStatus,
  type InstallStatus,
  type LeadActivityType,
  type LeadInput,
  type LeadStatus,
} from "./leads-format.ts";
import { createOnboard, findCustomerDuplicates } from "./onboard-create.ts";
import type { OnboardingType } from "./onboard-import-format.ts";
import type { ActivationMode, DuplicateMatch } from "./onboard.ts";

export {
  ACTIVITY_TYPES,
  CONTACT_METHODS,
  COVERAGE_STATUSES,
  DEFAULT_LEAD_SOURCES,
  INSTALL_STATUSES,
  LEAD_STATUSES,
  LEAD_TYPES,
  leadStatusLabel,
  parseLatitude,
  parseLongitude,
} from "./leads-format.ts";
export type { LeadActivityType, LeadInput, LeadStatus } from "./leads-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const CLOSED = new Set(["converted", "lost", "cancelled", "duplicate", "not_interested", "outside_coverage"]);

export type LeadRow = {
  id: string;
  tenant_id: string;
  lead_number: string;
  name: string;
  phone: string;
  alternative_phone: string;
  email: string;
  identifier: string;
  lead_source: string;
  lead_type: string;
  status: string;
  coverage_status: string;
  coverage_checked_at: string | null;
  coverage_checked_by: string;
  coverage_notes: string;
  interested_package_id: string | null;
  package_name: string;
  interested_service_type: string;
  latitude: number | null;
  longitude: number | null;
  county: string;
  town: string;
  area: string;
  building: string;
  physical_address: string;
  location_notes: string;
  preferred_contact_method: string;
  assigned_to: string;
  assignee_name: string;
  next_follow_up_at: string | null;
  installation_status: string;
  scheduled_installation_at: string | null;
  completed_installation_at: string | null;
  assigned_technician: string;
  technician_name: string;
  installation_notes: string;
  notes: string;
  lost_reason: string;
  converted_at: string | null;
  converted_by: string;
  customer_id: string | null;
  service_id: string | null;
  conversion_status: string;
  converted_customer_label: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type LeadActivity = {
  id: string;
  activity_type: string;
  body: string;
  actor_id: string;
  created_at: string;
};

const LEAD_SELECT = `
  l.id, l.tenant_id, l.lead_number, l.name, l.phone, l.alternative_phone, l.email, l.identifier,
  l.lead_source, l.lead_type, l.status, l.coverage_status,
  l.coverage_checked_at::text as coverage_checked_at, l.coverage_checked_by, l.coverage_notes,
  l.interested_package_id, coalesce(p.name, '') as package_name, l.interested_service_type,
  l.latitude, l.longitude, l.county, l.town, l.area, l.building, l.physical_address, l.location_notes,
  l.preferred_contact_method, l.assigned_to, coalesce(au.name, '') as assignee_name,
  l.next_follow_up_at::text as next_follow_up_at, l.installation_status,
  l.scheduled_installation_at::text as scheduled_installation_at,
  l.completed_installation_at::text as completed_installation_at,
  l.assigned_technician, coalesce(tu.name, '') as technician_name, l.installation_notes, l.notes, l.lost_reason,
  l.converted_at::text as converted_at, l.converted_by, l.customer_id, l.service_id, l.conversion_status,
  l.converted_customer_label, l.created_by, l.created_at::text as created_at, l.updated_at::text as updated_at
`;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = String(value || "").trim() as T;
  return allowed.includes(v) ? v : fallback;
}

function clip(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function parseWhen(raw: unknown): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00+03:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${v}:00+03:00`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("Enter a valid date");
  return d.toISOString();
}

function requirePhone(phone: string) {
  if (last9Phone(phone).length < 9) throw new Error("Enter a valid phone number");
}

function emailOrBlank(raw: unknown) {
  const email = clip(raw, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email or leave it blank");
  return email;
}

async function audit(sql: Sql, tenantId: string, userId: string, action: string, entityId: string, details: Record<string, unknown>) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, 'lead', ${entityId}, ${JSON.stringify(details)})`;
}

async function addActivity(sql: Sql, tenantId: string, leadId: string, actorId: string, type: LeadActivityType, body: string) {
  await sql`insert into lead_activities (id, tenant_id, lead_id, activity_type, body, actor_id)
    values (${nid("lac")}, ${tenantId}, ${leadId}, ${type}, ${body.slice(0, 2000)}, ${actorId})`;
}

async function nextLeadNumber(sql: Sql, tenantId: string) {
  const [row] = await sql<{ next_n: number }>`
    insert into lead_sequences (tenant_id, next_n) values (${tenantId}, 1)
    on conflict (tenant_id) do update set next_n = lead_sequences.next_n + 1
    returning next_n`;
  const n = row?.next_n ?? 1;
  return `LD-${String(n).padStart(6, "0")}`;
}

export async function ensureLeadSources(sql: Sql, tenantId: string) {
  const [n] = await sql<{ n: number }>`select count(*)::int as n from lead_sources where tenant_id = ${tenantId}`;
  if ((n?.n ?? 0) > 0) return listLeadSources(sql, tenantId);
  for (let i = 0; i < DEFAULT_LEAD_SOURCES.length; i += 1) {
    await sql`insert into lead_sources (id, tenant_id, name, sort_order)
      values (${nid("src")}, ${tenantId}, ${DEFAULT_LEAD_SOURCES[i]}, ${i})
      on conflict (tenant_id, name) do nothing`;
  }
  return listLeadSources(sql, tenantId);
}

export async function listLeadSources(sql: Sql, tenantId: string) {
  return sql<{ id: string; name: string }>`
    select id, name from lead_sources where tenant_id = ${tenantId} and active = true order by sort_order, name`;
}

export async function rememberLeadSource(sql: Sql, tenantId: string, name: string) {
  const label = clip(name, 80);
  if (!label) return;
  const [existing] = await sql<{ id: string }>`
    select id from lead_sources where tenant_id = ${tenantId} and lower(name) = lower(${label})`;
  if (existing) return;
  await sql`insert into lead_sources (id, tenant_id, name, sort_order)
    values (${nid("src")}, ${tenantId}, ${label}, 100)
    on conflict (tenant_id, name) do nothing`;
}

async function assertPackage(sql: Sql, tenantId: string, packageId: string) {
  if (!packageId) return null;
  const [pkg] = await sql<{ id: string; name: string; access_method: string; active: boolean }>`
    select id, name, access_method, active from packages where id = ${packageId} and tenant_id = ${tenantId}`;
  if (!pkg || !pkg.active) throw new Error("Choose an active package on this network");
  return pkg;
}

const FROM = `from leads l
  left join packages p on p.id = l.interested_package_id and p.tenant_id = l.tenant_id
  left join "user" au on au.id = l.assigned_to
  left join "user" tu on tu.id = l.assigned_technician`;

async function readLead(sql: Sql, tenantId: string, leadId: string) {
  const rows = await sql.query<LeadRow>(
    `select ${LEAD_SELECT} ${FROM} where l.tenant_id = $1 and l.id = $2 and l.archived_at is null`,
    [tenantId, leadId],
  );
  return rows[0] || null;
}

export async function createLead(sql: Sql, opts: { tenantId: string; actorId: string; input: LeadInput }): Promise<LeadRow> {
  const name = clip(opts.input.name, 120);
  if (!name) throw new Error("Lead name is required");
  const phone = clip(opts.input.phone, 32);
  requirePhone(phone);
  const email = emailOrBlank(opts.input.email);
  const latitude = parseLatitude(opts.input.latitude);
  const longitude = parseLongitude(opts.input.longitude);
  const source = clip(opts.input.lead_source, 80) || "Other";
  const packageId = clip(opts.input.interested_package_id, 80);
  const pkg = await assertPackage(sql, opts.tenantId, packageId);
  await ensureLeadSources(sql, opts.tenantId);
  await rememberLeadSource(sql, opts.tenantId, source);
  const id = nid("led");
  const number = await nextLeadNumber(sql, opts.tenantId);
  const method = oneOf(opts.input.preferred_contact_method, CONTACT_METHODS, "phone");
  const leadType = oneOf(opts.input.lead_type, LEAD_TYPES, "individual");
  await sql`insert into leads (
      id, tenant_id, lead_number, name, phone, alternative_phone, email, identifier, lead_source, lead_type,
      interested_package_id, interested_service_type, latitude, longitude, county, town, area, building,
      physical_address, location_notes, preferred_contact_method, assigned_to, notes, created_by
    ) values (
      ${id}, ${opts.tenantId}, ${number}, ${name}, ${phone}, ${clip(opts.input.alternative_phone, 32)}, ${email},
      ${clip(opts.input.identifier, 40)}, ${source}, ${leadType}, ${pkg?.id || null},
      ${pkg?.access_method || clip(opts.input.interested_service_type, 20)}, ${latitude}, ${longitude},
      ${clip(opts.input.county, 80)}, ${clip(opts.input.town, 80)}, ${clip(opts.input.area, 80)},
      ${clip(opts.input.building, 80)}, ${clip(opts.input.physical_address, 240)}, ${clip(opts.input.location_notes, 500)},
      ${method}, ${clip(opts.input.assigned_to, 80)}, ${clip(opts.input.notes, 4000)}, ${opts.actorId}
    )`;
  await addActivity(sql, opts.tenantId, id, opts.actorId, "NOTE", "Lead created");
  await audit(sql, opts.tenantId, opts.actorId, "lead.created", id, { lead_number: number, name });
  const row = await readLead(sql, opts.tenantId, id);
  if (!row) throw new Error("Could not save the lead");
  return row;
}

export async function updateLead(sql: Sql, opts: { tenantId: string; actorId: string; leadId: string; input: LeadInput }) {
  const current = await readLead(sql, opts.tenantId, opts.leadId);
  if (!current) throw new Error("Lead not found");
  if (current.conversion_status === "converted") throw new Error("A converted lead is kept for history and cannot be edited");
  const name = clip(opts.input.name, 120);
  if (!name) throw new Error("Lead name is required");
  const phone = clip(opts.input.phone, 32);
  requirePhone(phone);
  const email = emailOrBlank(opts.input.email);
  const latitude = parseLatitude(opts.input.latitude);
  const longitude = parseLongitude(opts.input.longitude);
  const source = clip(opts.input.lead_source, 80) || current.lead_source;
  const packageId = opts.input.interested_package_id === undefined ? current.interested_package_id || "" : clip(opts.input.interested_package_id, 80);
  const pkg = await assertPackage(sql, opts.tenantId, packageId);
  await rememberLeadSource(sql, opts.tenantId, source);
  await sql`update leads set
      name = ${name}, phone = ${phone}, alternative_phone = ${clip(opts.input.alternative_phone, 32)}, email = ${email},
      identifier = ${clip(opts.input.identifier, 40)}, lead_source = ${source},
      lead_type = ${oneOf(opts.input.lead_type, LEAD_TYPES, current.lead_type as "individual")},
      interested_package_id = ${pkg?.id || null},
      interested_service_type = ${pkg?.access_method || clip(opts.input.interested_service_type, 20)},
      latitude = ${latitude}, longitude = ${longitude},
      county = ${clip(opts.input.county, 80)}, town = ${clip(opts.input.town, 80)}, area = ${clip(opts.input.area, 80)},
      building = ${clip(opts.input.building, 80)}, physical_address = ${clip(opts.input.physical_address, 240)},
      location_notes = ${clip(opts.input.location_notes, 500)},
      preferred_contact_method = ${oneOf(opts.input.preferred_contact_method, CONTACT_METHODS, current.preferred_contact_method as "phone")},
      assigned_to = ${opts.input.assigned_to === undefined ? current.assigned_to : clip(opts.input.assigned_to, 80)},
      notes = ${clip(opts.input.notes, 4000)}, updated_at = now()
    where id = ${opts.leadId} and tenant_id = ${opts.tenantId}`;
  await audit(sql, opts.tenantId, opts.actorId, "lead.updated", opts.leadId, { lead_number: current.lead_number });
  const row = await readLead(sql, opts.tenantId, opts.leadId);
  if (!row) throw new Error("Lead not found");
  return row;
}

export async function listLeads(
  sql: Sql,
  tenantId: string,
  query: { q?: string; status?: string; coverage?: string; installation?: string; source?: string; assigned_to?: string; page?: number; sort?: string } = {},
) {
  const q = clip(query.q, 80);
  const like = `%${q.replace(/[#%_]/g, (ch) => `#${ch}`)}%`;
  const status = LEAD_STATUSES.includes(query.status as LeadStatus) ? String(query.status) : "";
  const coverage = COVERAGE_STATUSES.includes(query.coverage as CoverageStatus) ? String(query.coverage) : "";
  const installation = INSTALL_STATUSES.includes(query.installation as InstallStatus) ? String(query.installation) : "";
  const source = clip(query.source, 80);
  const assigned = clip(query.assigned_to, 80);
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const limit = 25;
  const offset = (page - 1) * limit;
  const sort = query.sort === "name" || query.sort === "status" || query.sort === "follow_up" ? query.sort : "created";
  const where = `l.tenant_id = $1 and l.archived_at is null
    and ($2 = '' or l.name ilike $3 escape '#' or l.phone ilike $3 escape '#' or l.email ilike $3 escape '#'
      or l.lead_number ilike $3 escape '#' or l.area ilike $3 escape '#' or l.town ilike $3 escape '#')
    and ($4 = '' or l.status = $4)
    and ($5 = '' or l.coverage_status = $5)
    and ($6 = '' or l.installation_status = $6)
    and ($7 = '' or l.lead_source = $7)
    and ($8 = '' or l.assigned_to = $8)`;
  const params = [tenantId, q, like, status, coverage, installation, source, assigned];
  const order =
    sort === "name" ? "l.name asc" : sort === "status" ? "l.status asc, l.created_at desc" : sort === "follow_up" ? "l.next_follow_up_at asc nulls last" : "l.created_at desc";
  const rows = await sql.query<LeadRow>(
    `select ${LEAD_SELECT} ${FROM} where ${where} order by ${order} limit ${limit} offset ${offset}`,
    params,
  );
  const [count] = await sql.query<{ n: number }>(`select count(*)::int as n from leads l where ${where}`, params);
  return { rows, total: count?.n ?? 0, page, pageSize: limit };
}

export async function getLead(sql: Sql, tenantId: string, leadId: string) {
  const lead = await readLead(sql, tenantId, leadId);
  if (!lead) throw new Error("Lead not found");
  const activities = await sql<LeadActivity>`
    select id, activity_type, body, actor_id, created_at::text as created_at
    from lead_activities where tenant_id = ${tenantId} and lead_id = ${leadId}
    order by created_at desc limit 80`;
  return { lead, activities };
}

export async function setLeadStatus(sql: Sql, opts: { tenantId: string; actorId: string; leadId: string; status: string; lost_reason?: string }) {
  const lead = await readLead(sql, opts.tenantId, opts.leadId);
  if (!lead) throw new Error("Lead not found");
  if (lead.conversion_status === "converted") throw new Error("A converted lead cannot change status");
  const status = oneOf(opts.status, LEAD_STATUSES, "" as LeadStatus);
  if (!status || status === "converted") throw new Error("Choose a lead status");
  const reason = clip(opts.lost_reason, 240);
  await sql`update leads set status = ${status}, lost_reason = ${reason || lead.lost_reason}, updated_at = now()
    where id = ${opts.leadId} and tenant_id = ${opts.tenantId}`;
  await addActivity(sql, opts.tenantId, opts.leadId, opts.actorId, "STATUS_CHANGE", `${lead.status} → ${status}${reason ? ` (${reason})` : ""}`);
  await audit(sql, opts.tenantId, opts.actorId, status === "lost" ? "lead.lost" : "lead.status_changed", opts.leadId, {
    from: lead.status,
    to: status,
    lead_number: lead.lead_number,
  });
  const row = await readLead(sql, opts.tenantId, opts.leadId);
  if (!row) throw new Error("Lead not found");
  return row;
}

export async function recordCoverage(
  sql: Sql,
  opts: { tenantId: string; actorId: string; leadId: string; coverage_status: string; coverage_notes?: string },
) {
  const lead = await readLead(sql, opts.tenantId, opts.leadId);
  if (!lead) throw new Error("Lead not found");
  const status = oneOf(opts.coverage_status, COVERAGE_STATUSES, "" as CoverageStatus);
  if (!status) throw new Error("Choose a coverage result");
  const notes = clip(opts.coverage_notes, 1000);
  const nextStatus = CLOSED.has(lead.status) || lead.status === "confirmed" ? lead.status : "coverage_check";
  await sql`update leads set coverage_status = ${status}, coverage_notes = ${notes}, coverage_checked_at = now(),
      coverage_checked_by = ${opts.actorId}, status = ${nextStatus}, updated_at = now()
    where id = ${opts.leadId} and tenant_id = ${opts.tenantId}`;
  await addActivity(sql, opts.tenantId, opts.leadId, opts.actorId, "COVERAGE_CHECK", `${status}${notes ? ` — ${notes}` : ""}`);
  await audit(sql, opts.tenantId, opts.actorId, "lead.coverage_checked", opts.leadId, { coverage_status: status, lead_number: lead.lead_number });
  const row = await readLead(sql, opts.tenantId, opts.leadId);
  if (!row) throw new Error("Lead not found");
  return row;
}

export async function recordInstallation(
  sql: Sql,
  opts: {
    tenantId: string;
    actorId: string;
    leadId: string;
    installation_status: string;
    scheduled_installation_at?: string | null;
    assigned_technician?: string;
    installation_notes?: string;
  },
) {
  const lead = await readLead(sql, opts.tenantId, opts.leadId);
  if (!lead) throw new Error("Lead not found");
  if (lead.conversion_status === "converted") throw new Error("Installation is already closed on a converted lead");
  const status = oneOf(opts.installation_status, INSTALL_STATUSES, "" as InstallStatus);
  if (!status) throw new Error("Choose an installation status");
  const when = opts.scheduled_installation_at === undefined ? lead.scheduled_installation_at : parseWhen(opts.scheduled_installation_at);
  const tech = opts.assigned_technician === undefined ? lead.assigned_technician : clip(opts.assigned_technician, 80);
  const notes = opts.installation_notes === undefined ? lead.installation_notes : clip(opts.installation_notes, 2000);
  let pipeline = lead.status;
  if (!CLOSED.has(lead.status)) {
    if (status === "scheduled" || status === "in_progress") pipeline = "installation_scheduled";
    if (status === "not_scheduled" && (lead.status === "new" || lead.status === "contacted" || lead.status === "qualified" || lead.status === "coverage_check")) {
      pipeline = "installation_pending";
    }
    if (status === "completed") pipeline = "installation_completed";
  }
  const completed = status === "completed" ? new Date().toISOString() : null;
  await sql`update leads set installation_status = ${status}, scheduled_installation_at = ${when},
      completed_installation_at = ${completed}, assigned_technician = ${tech}, installation_notes = ${notes},
      status = ${pipeline}, updated_at = now()
    where id = ${opts.leadId} and tenant_id = ${opts.tenantId}`;
  await addActivity(sql, opts.tenantId, opts.leadId, opts.actorId, "INSTALLATION", `${status}${notes ? ` — ${notes}` : ""}`);
  await audit(sql, opts.tenantId, opts.actorId, status === "completed" ? "lead.installation_completed" : "lead.installation_scheduled", opts.leadId, {
    installation_status: status,
    lead_number: lead.lead_number,
  });
  const row = await readLead(sql, opts.tenantId, opts.leadId);
  if (!row) throw new Error("Lead not found");
  return row;
}

export async function scheduleFollowUp(
  sql: Sql,
  opts: { tenantId: string; actorId: string; leadId: string; next_follow_up_at: string; assigned_to?: string; note?: string },
) {
  const lead = await readLead(sql, opts.tenantId, opts.leadId);
  if (!lead) throw new Error("Lead not found");
  if (lead.conversion_status === "converted") throw new Error("This lead is already converted");
  const when = parseWhen(opts.next_follow_up_at);
  if (!when) throw new Error("Choose a follow-up time");
  const assigned = opts.assigned_to === undefined ? lead.assigned_to : clip(opts.assigned_to, 80);
  const note = clip(opts.note, 1000);
  await sql`update leads set next_follow_up_at = ${when}, assigned_to = ${assigned}, updated_at = now()
    where id = ${opts.leadId} and tenant_id = ${opts.tenantId}`;
  await addActivity(sql, opts.tenantId, opts.leadId, opts.actorId, "FOLLOW_UP", note || `Follow up ${when}`);
  await audit(sql, opts.tenantId, opts.actorId, "lead.follow_up", opts.leadId, { at: when, assigned_to: assigned });
  const row = await readLead(sql, opts.tenantId, opts.leadId);
  if (!row) throw new Error("Lead not found");
  return row;
}

export async function logLeadActivity(
  sql: Sql,
  opts: { tenantId: string; actorId: string; leadId: string; activity_type: string; body?: string },
) {
  const lead = await readLead(sql, opts.tenantId, opts.leadId);
  if (!lead) throw new Error("Lead not found");
  const type = oneOf(opts.activity_type, ACTIVITY_TYPES, "" as LeadActivityType);
  if (!type || type === "CONVERSION" || type === "STATUS_CHANGE") throw new Error("Choose an activity");
  await addActivity(sql, opts.tenantId, opts.leadId, opts.actorId, type, clip(opts.body, 2000) || type);
  return getLead(sql, opts.tenantId, opts.leadId);
}

export async function assignLead(sql: Sql, opts: { tenantId: string; actorId: string; leadId: string; assigned_to: string }) {
  const lead = await readLead(sql, opts.tenantId, opts.leadId);
  if (!lead) throw new Error("Lead not found");
  const assigned = clip(opts.assigned_to, 80);
  await sql`update leads set assigned_to = ${assigned}, updated_at = now() where id = ${opts.leadId} and tenant_id = ${opts.tenantId}`;
  await audit(sql, opts.tenantId, opts.actorId, "lead.assigned", opts.leadId, { assigned_to: assigned, lead_number: lead.lead_number });
  const row = await readLead(sql, opts.tenantId, opts.leadId);
  if (!row) throw new Error("Lead not found");
  return row;
}

export async function archiveLead(sql: Sql, opts: { tenantId: string; actorId: string; leadId: string }) {
  const lead = await readLead(sql, opts.tenantId, opts.leadId);
  if (!lead) throw new Error("Lead not found");
  if (lead.conversion_status === "converted") throw new Error("Converted leads stay in history and cannot be deleted");
  await sql`update leads set archived_at = now(), updated_at = now() where id = ${opts.leadId} and tenant_id = ${opts.tenantId}`;
  await audit(sql, opts.tenantId, opts.actorId, "lead.archived", opts.leadId, { lead_number: lead.lead_number });
  return { ok: true };
}

export async function findLeadCustomerMatches(sql: Sql, tenantId: string, lead: Pick<LeadRow, "name" | "phone" | "alternative_phone" | "email" | "identifier">) {
  const hits = new Map<string, DuplicateMatch>();
  const push = (row: DuplicateMatch) => {
    const prev = hits.get(row.id);
    if (!prev || (row.blocking && !prev.blocking)) hits.set(row.id, row);
  };
  for (const row of await findCustomerDuplicates(sql, tenantId, { name: lead.name, phone: lead.phone, email: lead.email })) push(row);
  if (last9Phone(lead.alternative_phone).length >= 9) {
    for (const row of await findCustomerDuplicates(sql, tenantId, { name: "", phone: lead.alternative_phone, email: "" })) push(row);
  }
  const ident = lead.identifier.trim();
  if (ident) {
    const rows = await sql<{ id: string; name: string; phone: string; email: string; account_number: string }>`
      select id, name, phone, email, coalesce(account_number,'') as account_number
      from customers where tenant_id = ${tenantId} and deleted_at is null and kra_pin <> '' and lower(kra_pin) = lower(${ident})`;
    for (const row of rows) {
      push({ ...row, reason: "phone", blocking: true });
    }
  }
  return [...hits.values()].sort((a, b) => Number(b.blocking) - Number(a.blocking));
}

function customerAddress(lead: LeadRow) {
  const place = [lead.physical_address, lead.building, lead.area, lead.town, lead.county].filter(Boolean).join(", ");
  const gps = lead.latitude != null && lead.longitude != null ? `${lead.latitude}, ${lead.longitude}` : "";
  return [place, gps].filter(Boolean).join(" · ").slice(0, 240);
}

function customerNotes(lead: LeadRow) {
  const alt = lead.alternative_phone ? `Alternative phone: ${lead.alternative_phone}` : "";
  return [lead.notes, alt].filter(Boolean).join("\n").slice(0, 4000);
}

export async function convertLead(
  sql: Sql,
  opts: {
    tenantId: string;
    tenantName: string;
    actorId: string;
    leadId: string;
    useCustomerId?: string;
    acknowledgeDuplicates?: boolean;
    expiryYmd?: string;
    onboardingType?: OnboardingType;
    activation?: ActivationMode;
    sendNotification?: boolean;
    canActivateNow?: boolean;
    canOverrideExpiry?: boolean;
    confirmed?: boolean;
  },
) {
  await sql.query("begin");
  try {
    const [locked] = await sql<{ id: string; conversion_status: string; installation_status: string }>`
      select id, conversion_status, installation_status from leads
      where id = ${opts.leadId} and tenant_id = ${opts.tenantId} and archived_at is null
      for update`;
    if (!locked) throw new Error("Lead not found");
    if (locked.conversion_status === "converted") throw new Error("This lead is already converted");
    if (locked.installation_status !== "completed") {
      throw new Error("Mark the installation completed, then confirm and convert");
    }
    if (!opts.confirmed) throw new Error("Confirm the conversion before creating the customer");
    const lead = await readLead(sql, opts.tenantId, opts.leadId);
    if (!lead) throw new Error("Lead not found");
    const matches = await findLeadCustomerMatches(sql, opts.tenantId, lead);
    const useId = clip(opts.useCustomerId, 80);
    if (!useId && matches.some((m) => m.blocking)) {
      throw new Error("Existing customer found. Choose that customer instead of creating a duplicate.");
    }
    if (!useId && matches.length && !opts.acknowledgeDuplicates) {
      throw new Error("Possible duplicate customer. Confirm before creating a new one.");
    }
    const pkg = lead.interested_package_id ? await assertPackage(sql, opts.tenantId, lead.interested_package_id) : null;
    const onboarding = opts.onboardingType === "continuing" ? "continuing" : "new";
    const activation: ActivationMode = opts.activation === "active" || opts.activation === "after_partial" ? opts.activation : "after_payment";
    let customerId = useId;
    let serviceId: string | null = null;
    let accountNumber = "";
    if (useId && !pkg) {
      const [existing] = await sql<{ id: string; account_number: string }>`
        select id, coalesce(account_number,'') as account_number
        from customers where id = ${useId} and tenant_id = ${opts.tenantId} and deleted_at is null`;
      if (!existing) throw new Error("Customer not found");
      customerId = existing.id;
      accountNumber = existing.account_number;
    } else {
      const result = await createOnboard(sql, {
        tenantId: opts.tenantId,
        tenantName: opts.tenantName,
        actorId: opts.actorId,
        canActivateNow: opts.canActivateNow,
        canOverrideExpiry: opts.canOverrideExpiry,
        input: {
          customer_mode: useId ? "existing" : "new",
          customer_id: useId || undefined,
          acknowledge_duplicates: true,
          customer: useId
            ? undefined
            : {
                name: lead.name,
                phone: lead.phone,
                email: lead.email,
                address: customerAddress(lead),
                type: lead.lead_type === "business" ? "business" : "individual",
                tag_ids: [],
                account_number: "",
                notes: customerNotes(lead),
                portal_password: "",
              },
          include_service: Boolean(pkg),
          service: pkg
            ? {
                access_method: pkg.access_method as "pppoe" | "static" | "hotspot",
                package_id: pkg.id,
                username: "",
                auto_username: true,
                static_ip: "",
                pool_id: "",
                router_id: "",
                mac_address: "",
                cpe_id: "",
                expiry_ymd: opts.expiryYmd || "",
                activation,
                notes: lead.installation_notes,
                hotspot_mode: "account",
                onboarding_type: onboarding,
                send_onboarding_notification: opts.sendNotification !== false,
              }
            : undefined,
        },
      });
      if (result.partial_error) throw new Error(result.partial_error);
      customerId = result.customer_id;
      serviceId = result.service_id;
      accountNumber = result.customer_account_number;
    }
    if (!useId && lead.identifier) {
      await sql`update customers set kra_pin = ${clip(lead.identifier, 40)}
        where id = ${customerId} and tenant_id = ${opts.tenantId} and kra_pin = ''`;
    }
    const [cus] = await sql<{ name: string; account_number: string }>`
      select name, coalesce(account_number,'') as account_number from customers where id = ${customerId} and tenant_id = ${opts.tenantId}`;
    const label = `${cus?.name || lead.name}${cus?.account_number ? ` · ${cus.account_number}` : ""}`;
    await sql`update leads set status = 'converted', conversion_status = 'converted', converted_at = now(),
        converted_by = ${opts.actorId}, customer_id = ${customerId}, service_id = ${serviceId},
        converted_customer_label = ${label}, updated_at = now()
      where id = ${opts.leadId} and tenant_id = ${opts.tenantId}`;
    await addActivity(
      sql,
      opts.tenantId,
      opts.leadId,
      opts.actorId,
      "CONVERSION",
      `Converted to customer ${customerId}${serviceId ? ` and service ${serviceId}` : ""}`,
    );
    await audit(sql, opts.tenantId, opts.actorId, "lead.converted", opts.leadId, {
      lead_id: opts.leadId,
      customer_id: customerId,
      service_id: serviceId,
      user_id: opts.actorId,
    });
    await sql.query("commit");
    const saved = await readLead(sql, opts.tenantId, opts.leadId);
    return { lead: saved, customer_id: customerId, service_id: serviceId, account_number: accountNumber || cus?.account_number || "" };
  } catch (err) {
    try {
      await sql.query("rollback");
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

export async function leadMetrics(sql: Sql, tenantId: string) {
  const [row] = await sql<{
    total: number;
    fresh: number;
    qualified: number;
    followups: number;
    installation_pending: number;
    converted: number;
    lost: number;
  }>`select
      count(*)::int as total,
      count(*) filter (where status = 'new')::int as fresh,
      count(*) filter (where status = 'qualified')::int as qualified,
      count(*) filter (where next_follow_up_at is not null and next_follow_up_at <= now() and conversion_status = 'open' and status not in ('lost','cancelled','duplicate','not_interested','outside_coverage'))::int as followups,
      count(*) filter (where conversion_status = 'open' and (status in ('installation_pending','installation_scheduled') or installation_status in ('scheduled','in_progress')))::int as installation_pending,
      count(*) filter (where conversion_status = 'converted')::int as converted,
      count(*) filter (where status in ('lost','cancelled','not_interested','outside_coverage','duplicate'))::int as lost
    from leads where tenant_id = ${tenantId} and archived_at is null`;
  const total = row?.total ?? 0;
  const converted = row?.converted ?? 0;
  return {
    total,
    fresh: row?.fresh ?? 0,
    qualified: row?.qualified ?? 0,
    followups: row?.followups ?? 0,
    installationPending: row?.installation_pending ?? 0,
    converted,
    lost: row?.lost ?? 0,
    conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
  };
}

export async function leadReport(sql: Sql, tenantId: string) {
  const metrics = await leadMetrics(sql, tenantId);
  const [avg] = await sql<{ days: number }>`
    select coalesce(avg(extract(epoch from (converted_at - created_at))) / 86400, 0)::int as days
    from leads where tenant_id = ${tenantId} and conversion_status = 'converted' and archived_at is null`;
  const bySource = await sql<{ label: string; n: number }>`
    select lead_source as label, count(*)::int as n from leads
    where tenant_id = ${tenantId} and archived_at is null group by lead_source order by n desc limit 12`;
  const byArea = await sql<{ label: string; n: number }>`
    select coalesce(nullif(area,''), 'Unspecified') as label, count(*)::int as n from leads
    where tenant_id = ${tenantId} and archived_at is null group by 1 order by n desc limit 12`;
  const byPackage = await sql<{ label: string; n: number }>`
    select coalesce(p.name, 'No package') as label, count(*)::int as n
    from leads l left join packages p on p.id = l.interested_package_id
    where l.tenant_id = ${tenantId} and l.archived_at is null group by 1 order by n desc limit 12`;
  const byStaff = await sql<{ label: string; n: number }>`
    select coalesce(nullif(u.name,''), nullif(l.assigned_to,''), 'Unassigned') as label, count(*)::int as n
    from leads l left join "user" u on u.id = l.assigned_to
    where l.tenant_id = ${tenantId} and l.archived_at is null group by 1 order by n desc limit 12`;
  const lostReasons = await sql<{ label: string; n: number }>`
    select coalesce(nullif(lost_reason,''), status) as label, count(*)::int as n from leads
    where tenant_id = ${tenantId} and archived_at is null and status in ('lost','cancelled','not_interested','outside_coverage','duplicate')
    group by 1 order by n desc limit 12`;
  return { ...metrics, averageDays: avg?.days ?? 0, bySource, byArea, byPackage, byStaff, lostReasons };
}

export async function exportLeadsCsv(sql: Sql, tenantId: string) {
  const rows = await sql.query<LeadRow>(
    `select ${LEAD_SELECT} ${FROM} where l.tenant_id = $1 and l.archived_at is null order by l.created_at desc limit 5000`,
    [tenantId],
  );
  const header = ["Lead", "Name", "Phone", "Area", "Package", "Source", "Status", "Coverage", "Installation", "Assigned", "Created", "Follow-up", "Customer", "Service"];
  const lines = [header.join(",")];
  for (const row of rows) {
    const cells = [
      row.lead_number,
      row.name,
      row.phone,
      row.area,
      row.package_name,
      row.lead_source,
      row.status,
      row.coverage_status,
      row.installation_status,
      row.assignee_name || row.assigned_to,
      row.created_at,
      row.next_follow_up_at || "",
      row.customer_id || "",
      row.service_id || "",
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
