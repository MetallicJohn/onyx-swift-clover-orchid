import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const FEATURE_CATALOG = [
  { id: "pppoe", label: "PPPoE" },
  { id: "hotspot", label: "Hotspot" },
  { id: "static_ip", label: "Static IP" },
  { id: "radius", label: "RADIUS" },
  { id: "mikrotik", label: "MikroTik management" },
  { id: "genieacs", label: "GenieACS" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "reports", label: "Reports" },
  { id: "customer_portal", label: "Customer portal" },
  { id: "reseller", label: "Reseller module" },
  { id: "technician", label: "Technician / field" },
  { id: "ai_assistant", label: "AI network assistant" },
  { id: "api_access", label: "API access" },
] as const;

export type FeatureId = (typeof FEATURE_CATALOG)[number]["id"];

export type PlanRecord = {
  code: string;
  name: string;
  description: string;
  monthly_kes: number;
  annual_kes: number;
  trial_days: number;
  max_customers: number;
  max_routers: number;
  max_services: number;
  max_admins: number;
  max_storage_gb: number;
  api_requests_per_day: number;
  support_level: string;
  entitlements: Record<string, boolean>;
  status: string;
  sort_order: number;
};

export const DEFAULT_PLANS: Record<string, Omit<PlanRecord, "code" | "status" | "sort_order">> = {
  trial: {
    name: "Trial",
    description: "14 days to onboard your first sites.",
    monthly_kes: 0,
    annual_kes: 0,
    trial_days: 14,
    max_customers: 50,
    max_routers: 5,
    max_services: 50,
    max_admins: 3,
    max_storage_gb: 5,
    api_requests_per_day: 1000,
    support_level: "community",
    entitlements: {
      pppoe: true,
      hotspot: true,
      static_ip: true,
      radius: true,
      mikrotik: true,
      reports: true,
      customer_portal: true,
    },
  },
  starter: {
    name: "Starter",
    description: "Single-POP operators and neighbourhood ISPs.",
    monthly_kes: 4999,
    annual_kes: 49990,
    trial_days: 0,
    max_customers: 500,
    max_routers: 20,
    max_services: 500,
    max_admins: 8,
    max_storage_gb: 20,
    api_requests_per_day: 5000,
    support_level: "email",
    entitlements: {
      pppoe: true,
      hotspot: true,
      static_ip: true,
      radius: true,
      mikrotik: true,
      genieacs: true,
      sms: true,
      reports: true,
      customer_portal: true,
      technician: true,
      api_access: true,
    },
  },
  growth: {
    name: "Growth",
    description: "Multi-POP with room to scale.",
    monthly_kes: 14999,
    annual_kes: 149990,
    trial_days: 0,
    max_customers: 5000,
    max_routers: 100,
    max_services: 5000,
    max_admins: 25,
    max_storage_gb: 100,
    api_requests_per_day: 25000,
    support_level: "priority",
    entitlements: {
      pppoe: true,
      hotspot: true,
      static_ip: true,
      radius: true,
      mikrotik: true,
      genieacs: true,
      whatsapp: true,
      sms: true,
      reports: true,
      customer_portal: true,
      reseller: true,
      technician: true,
      ai_assistant: true,
      api_access: true,
    },
  },
};

/** Compatibility catalog used before saas_plans is seeded and by existing tests. */
export const PLANS = {
  trial: {
    label: DEFAULT_PLANS.trial.name,
    blurb: DEFAULT_PLANS.trial.description,
    max_customers: 50,
    max_routers: 5,
    monthly_kes: 0,
  },
  starter: {
    label: DEFAULT_PLANS.starter.name,
    blurb: DEFAULT_PLANS.starter.description,
    max_customers: 500,
    max_routers: 20,
    monthly_kes: 4999,
  },
  growth: {
    label: DEFAULT_PLANS.growth.name,
    blurb: DEFAULT_PLANS.growth.description,
    max_customers: 5000,
    max_routers: 100,
    monthly_kes: 14999,
  },
} as const;

export type LegacyPlanCode = keyof typeof PLANS;

export function parseEntitlements(raw: unknown): Record<string, boolean> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = Boolean(v);
    return out;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseEntitlements(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return {};
}

function asPlan(row: {
  code: string;
  name: string;
  description: string;
  monthly_kes: number;
  annual_kes: number;
  trial_days: number;
  max_customers: number;
  max_routers: number;
  max_services: number;
  max_admins: number;
  max_storage_gb: number;
  api_requests_per_day: number;
  support_level: string;
  entitlements: unknown;
  status: string;
  sort_order: number;
}): PlanRecord {
  return { ...row, entitlements: parseEntitlements(row.entitlements) };
}

export function featureForAccess(method: string): FeatureId {
  if (method === "hotspot") return "hotspot";
  if (method === "static") return "static_ip";
  return "pppoe";
}

export async function ensurePlans(sql: Sql) {
  const [n] = await sql<{ n: number }>`select count(*)::int as n from saas_plans`;
  if ((n?.n ?? 0) > 0) return;
  for (const [code, spec] of Object.entries(DEFAULT_PLANS)) {
    await sql`insert into saas_plans (
        id, code, name, description, monthly_kes, annual_kes, trial_days,
        max_customers, max_routers, max_services, max_admins, max_storage_gb, api_requests_per_day,
        support_level, entitlements, status, sort_order
      ) values (
        ${`plan_${code}`}, ${code}, ${spec.name}, ${spec.description}, ${spec.monthly_kes}, ${spec.annual_kes}, ${spec.trial_days},
        ${spec.max_customers}, ${spec.max_routers}, ${spec.max_services}, ${spec.max_admins}, ${spec.max_storage_gb},
        ${spec.api_requests_per_day}, ${spec.support_level}, ${JSON.stringify(spec.entitlements)}, 'active', 10
      ) on conflict (code) do nothing`;
  }
}

export async function listPlans(sql: Sql, includeArchived = false): Promise<PlanRecord[]> {
  await ensurePlans(sql);
  const rows = includeArchived
    ? await sql<Parameters<typeof asPlan>[0]>`
        select code, name, description, monthly_kes, annual_kes, trial_days, max_customers, max_routers,
               max_services, max_admins, max_storage_gb, api_requests_per_day, support_level, entitlements,
               status, sort_order
        from saas_plans order by sort_order, name`
    : await sql<Parameters<typeof asPlan>[0]>`
        select code, name, description, monthly_kes, annual_kes, trial_days, max_customers, max_routers,
               max_services, max_admins, max_storage_gb, api_requests_per_day, support_level, entitlements,
               status, sort_order
        from saas_plans where status = 'active' order by sort_order, name`;
  return rows.map(asPlan);
}

export async function getPlan(sql: Sql, code: string): Promise<PlanRecord | null> {
  await ensurePlans(sql);
  const [row] = await sql<Parameters<typeof asPlan>[0]>`
    select code, name, description, monthly_kes, annual_kes, trial_days, max_customers, max_routers,
           max_services, max_admins, max_storage_gb, api_requests_per_day, support_level, entitlements,
           status, sort_order
    from saas_plans where code = ${code}`;
  if (row) return asPlan(row);
  const fallback = DEFAULT_PLANS[code];
  if (!fallback) return null;
  return { code, status: "active", sort_order: 0, ...fallback };
}

function slugCode(name: string) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return s || `plan_${nid("p").slice(-6)}`;
}

export type PlanInput = {
  code?: string;
  name: string;
  description: string;
  monthly_kes: number;
  annual_kes: number;
  trial_days: number;
  max_customers: number;
  max_routers: number;
  max_services: number;
  max_admins: number;
  max_storage_gb: number;
  api_requests_per_day: number;
  support_level: string;
  entitlements: Record<string, boolean>;
  status?: string;
  sort_order?: number;
};

export async function upsertPlan(sql: Sql, input: PlanInput): Promise<PlanRecord> {
  const name = input.name.trim();
  if (!name) throw new Error("Plan name is required");
  const code = (input.code || slugCode(name)).trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(code)) throw new Error("Plan code must be letters, numbers, underscore");
  const status = input.status === "archived" ? "archived" : "active";
  const entitlements: Record<string, boolean> = {};
  for (const f of FEATURE_CATALOG) entitlements[f.id] = Boolean(input.entitlements?.[f.id]);
  const existing = await getPlan(sql, code);
  if (existing && existing.code === code) {
    await sql`update saas_plans set
      name = ${name},
      description = ${input.description.trim()},
      monthly_kes = ${Math.max(0, Math.round(input.monthly_kes || 0))},
      annual_kes = ${Math.max(0, Math.round(input.annual_kes || 0))},
      trial_days = ${Math.max(0, Math.round(input.trial_days || 0))},
      max_customers = ${Math.max(0, Math.round(input.max_customers || 0))},
      max_routers = ${Math.max(0, Math.round(input.max_routers || 0))},
      max_services = ${Math.max(0, Math.round(input.max_services || 0))},
      max_admins = ${Math.max(0, Math.round(input.max_admins || 0))},
      max_storage_gb = ${Math.max(0, Math.round(input.max_storage_gb || 0))},
      api_requests_per_day = ${Math.max(0, Math.round(input.api_requests_per_day || 0))},
      support_level = ${input.support_level.trim() || "community"},
      entitlements = ${JSON.stringify(entitlements)},
      status = ${status},
      sort_order = ${input.sort_order ?? existing.sort_order},
      updated_at = now()
      where code = ${code}`;
  } else {
    await sql`insert into saas_plans (
        id, code, name, description, monthly_kes, annual_kes, trial_days,
        max_customers, max_routers, max_services, max_admins, max_storage_gb, api_requests_per_day,
        support_level, entitlements, status, sort_order
      ) values (
        ${nid("plan")}, ${code}, ${name}, ${input.description.trim()}, ${Math.max(0, Math.round(input.monthly_kes || 0))},
        ${Math.max(0, Math.round(input.annual_kes || 0))}, ${Math.max(0, Math.round(input.trial_days || 0))},
        ${Math.max(0, Math.round(input.max_customers || 0))}, ${Math.max(0, Math.round(input.max_routers || 0))},
        ${Math.max(0, Math.round(input.max_services || 0))}, ${Math.max(0, Math.round(input.max_admins || 0))},
        ${Math.max(0, Math.round(input.max_storage_gb || 0))}, ${Math.max(0, Math.round(input.api_requests_per_day || 0))},
        ${input.support_level.trim() || "community"}, ${JSON.stringify(entitlements)}, ${status},
        ${input.sort_order ?? 100}
      )`;
  }
  const saved = await getPlan(sql, code);
  if (!saved) throw new Error("Could not save plan");
  return saved;
}

export async function setPlanStatus(sql: Sql, code: string, status: "active" | "archived") {
  const plan = await getPlan(sql, code);
  if (!plan) throw new Error("Plan not found");
  await sql`update saas_plans set status = ${status}, updated_at = now() where code = ${code}`;
  return getPlan(sql, code);
}

export async function entitlementsForTenant(sql: Sql, tenantId: string): Promise<Record<string, boolean>> {
  const [row] = await sql<{ entitlements: unknown; plan: string }>`
    select entitlements, plan from tenant_subscriptions where tenant_id = ${tenantId}`;
  if (row?.entitlements) {
    const parsed = parseEntitlements(row.entitlements);
    if (Object.keys(parsed).length) return parsed;
  }
  const plan = await getPlan(sql, row?.plan || "trial");
  return plan?.entitlements ?? DEFAULT_PLANS.trial.entitlements;
}

export async function hasFeature(sql: Sql, tenantId: string, feature: string) {
  const ents = await entitlementsForTenant(sql, tenantId);
  return Boolean(ents[feature]);
}

export async function assertFeature(sql: Sql, tenantId: string, feature: string) {
  if (!(await hasFeature(sql, tenantId, feature))) {
    const label = FEATURE_CATALOG.find((f) => f.id === feature)?.label ?? feature;
    throw new Error(`Your plan does not include ${label}. Upgrade in Settings → Plan.`);
  }
}

export async function publicCatalog(sql: Sql) {
  const plans = await listPlans(sql, false);
  return plans.map((p) => ({
    code: p.code,
    name: p.name,
    description: p.description,
    monthly_kes: p.monthly_kes,
    annual_kes: p.annual_kes,
    trial_days: p.trial_days,
    max_customers: p.max_customers,
    max_routers: p.max_routers,
    max_services: p.max_services,
    max_admins: p.max_admins,
    support_level: p.support_level,
    features: FEATURE_CATALOG.filter((f) => p.entitlements[f.id]).map((f) => ({
      id: f.id,
      label: f.label,
    })),
  }));
}

export type PublicPlan = Awaited<ReturnType<typeof publicCatalog>>[number];

