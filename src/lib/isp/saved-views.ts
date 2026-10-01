import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
};

export const VIEW_DENSITIES = ["comfortable", "compact", "dense"] as const;
export type ViewDensity = (typeof VIEW_DENSITIES)[number];

export type ViewJson = string | number | boolean | null | ViewJson[] | { [key: string]: ViewJson };
export type ViewJsonObject = { [key: string]: ViewJson };

export type SavedViewInput = {
  id?: string;
  name?: string;
  resource?: string;
  filters?: unknown;
  sort?: unknown;
  columns?: unknown;
  density?: string;
  is_shared?: boolean;
};

export type SavedViewRow = {
  id: string;
  name: string;
  resource: string;
  filters: ViewJsonObject;
  sort: ViewJsonObject;
  columns: string[];
  density: ViewDensity;
  is_shared: boolean;
  user_id: string;
  mine: boolean;
  created_at: string;
  updated_at: string;
};

const RESOURCE = /^[a-z][a-z0-9_-]{0,40}$/;
const COLUMN = /^[a-z0-9_-]{1,40}$/;

export function normalizeSavedViewInput(raw: SavedViewInput) {
  const name = String(raw.name || "").trim().slice(0, 80);
  if (!name) throw new Error("Name the view");
  const resource = String(raw.resource || "").trim().toLowerCase();
  if (!RESOURCE.test(resource)) throw new Error("Unknown view");
  const filters = asJsonObject(raw.filters);
  const sort = asJsonObject(raw.sort);
  if (sort.dir && sort.dir !== "asc" && sort.dir !== "desc") throw new Error("Unknown sort");
  if (sort.key != null && typeof sort.key !== "string") throw new Error("Unknown sort");
  const columns = asColumns(raw.columns);
  const density = (VIEW_DENSITIES as readonly string[]).includes(String(raw.density || ""))
    ? (String(raw.density) as ViewDensity)
    : "comfortable";
  const packed = JSON.stringify({ filters, sort, columns });
  if (packed.length > 16000) throw new Error("That view is too large");
  return {
    id: String(raw.id || "").trim(),
    name,
    resource,
    filters,
    sort,
    columns,
    density,
    is_shared: raw.is_shared === true,
  };
}

function asJsonObject(value: unknown): ViewJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const parsed = JSON.parse(JSON.stringify(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as ViewJsonObject;
  } catch {
    return {};
  }
}

function parseObject(value: unknown): ViewJsonObject {
  if (typeof value === "string") {
    try {
      return asJsonObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asJsonObject(value);
}

function asColumns(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const id = String(item || "").trim().toLowerCase();
    if (!COLUMN.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= 40) break;
  }
  return out;
}

type DbRow = {
  id: string;
  name: string;
  resource: string;
  filters: ViewJsonObject | string;
  sort: ViewJsonObject | string;
  columns: string[] | string;
  density: string;
  is_shared: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
};

function parseJson<T>(value: T | string, fallback: T): T {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toRow(row: DbRow, userId: string): SavedViewRow {
  const density = (VIEW_DENSITIES as readonly string[]).includes(row.density) ? (row.density as ViewDensity) : "comfortable";
  const columns = parseJson<string[]>(row.columns, []);
  return {
    id: row.id,
    name: row.name,
    resource: row.resource,
    filters: parseObject(row.filters),
    sort: parseObject(row.sort),
    columns: Array.isArray(columns) ? columns.map(String) : [],
    density,
    is_shared: Boolean(row.is_shared),
    user_id: row.user_id,
    mine: row.user_id === userId,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listSavedViews(sql: Sql, tenantId: string, userId: string, resource: string, page = 1) {
  const key = String(resource || "").trim().toLowerCase();
  if (!RESOURCE.test(key)) return { rows: [] as SavedViewRow[], page: 1, pageSize: 50 };
  const size = 50;
  const offset = (Math.max(1, Math.trunc(page)) - 1) * size;
  const rows = await sql<DbRow>`
    select id, name, resource, filters, sort, columns, density, is_shared, user_id,
           created_at::text as created_at, updated_at::text as updated_at
    from saved_views
    where tenant_id = ${tenantId}
      and resource = ${key}
      and (user_id = ${userId} or is_shared = true)
    order by is_shared asc, lower(name) asc
    limit ${size} offset ${offset}`;
  return { rows: rows.map((row) => toRow(row, userId)), page: Math.max(1, Math.trunc(page)), pageSize: size };
}

export async function saveSavedView(sql: Sql, tenantId: string, userId: string, role: string, raw: SavedViewInput) {
  const input = normalizeSavedViewInput(raw);
  const owner = role === "isp_owner" || role === "isp_admin";
  const existing = input.id
    ? (
        await sql<DbRow>`
          select id, name, resource, filters, sort, columns, density, is_shared, user_id,
                 created_at::text as created_at, updated_at::text as updated_at
          from saved_views
          where id = ${input.id} and tenant_id = ${tenantId} and resource = ${input.resource}`
      )[0]
    : undefined;
  if (existing && existing.user_id !== userId && !(owner && existing.is_shared)) {
    throw new Error("You can only change your own view");
  }
  const id = existing?.id || nid("svw");
  const filters = JSON.stringify(input.filters);
  const sort = JSON.stringify(input.sort);
  const columns = JSON.stringify(input.columns);
  try {
    if (existing) {
      await sql`
        update saved_views
        set name = ${input.name},
            filters = ${filters}::jsonb,
            sort = ${sort}::jsonb,
            columns = ${columns}::jsonb,
            density = ${input.density},
            is_shared = ${input.is_shared},
            updated_at = now()
        where id = ${id} and tenant_id = ${tenantId}`;
    } else {
      await sql`
        insert into saved_views (id, tenant_id, user_id, name, resource, filters, sort, columns, density, is_shared)
        values (${id}, ${tenantId}, ${userId}, ${input.name}, ${input.resource}, ${filters}::jsonb, ${sort}::jsonb, ${columns}::jsonb, ${input.density}, ${input.is_shared})`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) throw new Error("A view with that name already exists");
    throw err;
  }
  const [row] = await sql<DbRow>`
    select id, name, resource, filters, sort, columns, density, is_shared, user_id,
           created_at::text as created_at, updated_at::text as updated_at
    from saved_views where id = ${id} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("Could not save the view");
  return toRow(row, userId);
}

export async function deleteSavedView(sql: Sql, tenantId: string, userId: string, role: string, id: string) {
  const viewId = String(id || "").trim();
  if (!viewId) throw new Error("View not found");
  const [row] = await sql<{ user_id: string; is_shared: boolean }>`
    select user_id, is_shared from saved_views where id = ${viewId} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("View not found");
  const owner = role === "isp_owner" || role === "isp_admin";
  if (row.user_id !== userId && !(owner && row.is_shared)) throw new Error("You can only delete your own view");
  await sql`delete from saved_views where id = ${viewId} and tenant_id = ${tenantId}`;
  return { ok: true as const };
}
