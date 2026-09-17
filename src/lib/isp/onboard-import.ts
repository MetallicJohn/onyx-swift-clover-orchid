import { nid } from "../utils.ts";
import { last9Phone } from "./customer-portal-format.ts";
import { createOnboard } from "./onboard-create.ts";
import {
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  defaultActivationForOnboarding,
  emptyColumnMap,
  isImportMode,
  isMigratingOnboard,
  mapRow,
  parseDelimitedText,
  previewImportRow,
  suggestColumnMap,
  type ImportColumnKey,
  type ImportMode,
  type ImportPreviewRow,
} from "./onboard-import-format.ts";
import type { AccessMethod } from "./types.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type ImportFileInput = {
  text: string;
  mode: ImportMode;
  map?: Record<ImportColumnKey, string>;
};

export type ImportContext = {
  packages: Array<{ id: string; name: string; access_method: AccessMethod; active: boolean; price_kes: number }>;
  routers: Array<{ id: string; name: string }>;
};

export type ValidatedImport = {
  mode: ImportMode;
  headers: string[];
  map: Record<ImportColumnKey, string>;
  rows: ImportPreviewRow[];
  ready: ImportPreviewRow[];
  error_count: number;
  ready_count: number;
  truncated: boolean;
  total_rows: number;
};

async function loadContext(sql: Sql, tenantId: string): Promise<ImportContext> {
  const packages = await sql<{
    id: string;
    name: string;
    access_method: AccessMethod;
    active: boolean;
    price_kes: number;
  }>`select id, name, access_method, active, price_kes from packages where tenant_id = ${tenantId}`;
  const routers = await sql<{ id: string; name: string }>`
    select id, name from routers where tenant_id = ${tenantId} order by name`;
  return { packages, routers };
}

export function parseImportFile(input: ImportFileInput) {
  const mode: ImportMode = isImportMode(input.mode) ? input.mode : "continuing";
  const parsed = parseDelimitedText(input.text);
  const map = input.map && Object.keys(input.map).some((k) => input.map?.[k as ImportColumnKey])
    ? input.map
    : suggestColumnMap(parsed.headers);
  return { mode, headers: parsed.headers, rows: parsed.rows, map };
}

export async function previewCustomerImport(
  sql: Sql,
  tenantId: string,
  input: ImportFileInput,
): Promise<ValidatedImport> {
  const mode: ImportMode = isImportMode(input.mode) ? input.mode : "continuing";
  const parsed = parseDelimitedText(input.text);
  const map = input.map && Object.keys(input.map).some((k) => input.map?.[k as ImportColumnKey])
    ? input.map
    : suggestColumnMap(parsed.headers);
  const ctx = await loadContext(sql, tenantId);
  const takenUsernames = new Set(
    (
      await sql<{ username: string }>`
        select lower(username) as username from services
        where tenant_id = ${tenantId} and deleted_at is null and username is not null and username <> ''`
    ).map((r) => r.username),
  );
  const phones = await sql<{ id: string; name: string; last9: string }>`
    select id, name, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) as last9
    from customers where tenant_id = ${tenantId} and deleted_at is null`;
  const phoneMap = new Map<string, { id: string; name: string }>();
  for (const p of phones) {
    if (p.last9.length >= 9 && !phoneMap.has(p.last9)) phoneMap.set(p.last9, { id: p.id, name: p.name });
  }
  const truncated = parsed.rows.length > MAX_IMPORT_ROWS;
  const slice = parsed.rows.slice(0, MAX_IMPORT_ROWS);
  const seenUsernames = new Set<string>();
  const rows: ImportPreviewRow[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    const raw = mapRow(parsed.headers, slice[i]!, map);
    const preview = previewImportRow(i + 2, raw, { mode, packages: ctx.packages });
    if (preview.username) {
      const key = preview.username.toLowerCase();
      if (seenUsernames.has(key) || takenUsernames.has(key)) {
        preview.errors.push({ field: "username", message: "That username is already in use on this network" });
      }
      seenUsernames.add(key);
    }
    const last9 = last9Phone(preview.phone);
    const existing = last9.length >= 9 ? phoneMap.get(last9) : undefined;
    if (existing) {
      if (isMigratingOnboard(preview.onboarding_type)) {
        preview.attach_customer_id = existing.id;
        preview.attach_customer_name = existing.name;
        preview.warnings.push({
          field: "phone",
          message: `Adds a new service on ${existing.name}. Existing lines keep their own expiry.`,
        });
      } else {
        preview.errors.push({ field: "phone", message: "A customer with this phone already exists on this network" });
      }
    }
    if (preview.router) {
      const router = ctx.routers.find((r) => r.name.toLowerCase() === preview.router.toLowerCase());
      if (!router) preview.warnings.push({ field: "router", message: "Router name was not matched; the line is still imported" });
    }
    rows.push(preview);
  }
  const ready = rows.filter((r) => r.errors.length === 0);
  return {
    mode,
    headers: parsed.headers,
    map,
    rows,
    ready,
    error_count: rows.length - ready.length,
    ready_count: ready.length,
    truncated,
    total_rows: parsed.rows.length,
  };
}

export async function confirmCustomerImport(
  sql: Sql,
  opts: {
    tenantId: string;
    tenantName: string;
    actorId: string;
    input: ImportFileInput;
    canActivateNow?: boolean;
  },
) {
  const preview = await previewCustomerImport(sql, opts.tenantId, opts.input);
  const batchId = nid("imp");
  const ctx = await loadContext(sql, opts.tenantId);
  let created = 0;
  let attached = 0;
  let skipped = 0;
  const errors: string[] = [];
  const createdPhones = new Map<string, string>();
  for (const row of preview.rows) {
    if (row.errors.length) {
      skipped += 1;
      errors.push(`Row ${row.line}: ${row.errors.map((e) => e.message).join("; ")}`);
      continue;
    }
    const pkg = ctx.packages.find((p) => p.name.toLowerCase() === row.package_name.toLowerCase() && p.active);
    if (!pkg) {
      skipped += 1;
      errors.push(`Row ${row.line}: Package not found on this network`);
      continue;
    }
    const router = row.router
      ? ctx.routers.find((r) => r.name.toLowerCase() === row.router.toLowerCase())
      : undefined;
    const migrating = isMigratingOnboard(row.onboarding_type);
    const last9 = last9Phone(row.phone);
    const attachId = migrating ? row.attach_customer_id || createdPhones.get(last9) : undefined;
    try {
      const result = await createOnboard(sql, {
        tenantId: opts.tenantId,
        tenantName: opts.tenantName,
        actorId: opts.actorId,
        canActivateNow: true,
        canOverrideExpiry: true,
        input: {
          customer_mode: attachId ? "existing" : "new",
          customer_id: attachId,
          acknowledge_duplicates: true,
          include_service: true,
          customer: attachId
            ? undefined
            : {
                name: row.name,
                phone: row.phone,
                email: row.raw.email,
                address: row.raw.address,
                type: "individual",
                tag_ids: [],
                account_number: row.account_number,
                notes: "",
                portal_password: "",
              },
          service: {
            name: pkg.name,
            access_method: pkg.access_method,
            package_id: pkg.id,
            username: row.username,
            auto_username: !row.username,
            static_ip: row.static_ip,
            pool_id: "",
            router_id: router?.id || "",
            mac_address: "",
            cpe_id: "",
            expiry_ymd: row.expiry_ymd,
            activation: defaultActivationForOnboarding(row.onboarding_type, pkg.price_kes),
            notes: "",
            hotspot_mode: "account",
            onboarding_type: row.onboarding_type,
            subscription_start_ymd: row.start_ymd,
            send_onboarding_notification: row.send_onboarding_notification,
            import_source: "csv",
            import_batch_id: batchId,
            pppoe_password: row.pppoe_password,
          },
        },
      });
      if (result.partial_error && !result.service_id) {
        skipped += 1;
        errors.push(`Row ${row.line}: ${result.partial_error}`);
        continue;
      }
      if (attachId) attached += 1;
      else created += 1;
      if (last9.length >= 9) createdPhones.set(last9, result.customer_id);
      if (result.partial_error) errors.push(`Row ${row.line}: ${result.partial_error}`);
    } catch (err) {
      skipped += 1;
      errors.push(`Row ${row.line}: ${err instanceof Error ? err.message : "Could not import"}`);
    }
  }
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (
      ${nid("aud")}, ${opts.tenantId}, ${opts.actorId}, 'customers.imported', 'import', ${batchId},
      ${JSON.stringify({ created, attached, skipped, mode: preview.mode, rows: preview.total_rows })}
    )`;
  return {
    created,
    attached,
    skipped,
    errors,
    batch_id: batchId,
    ready_count: preview.ready_count,
    error_count: preview.error_count,
    truncated: preview.truncated,
  };
}

export { IMPORT_COLUMNS, emptyColumnMap, MAX_IMPORT_ROWS };
