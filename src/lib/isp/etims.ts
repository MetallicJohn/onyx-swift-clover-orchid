import { nid } from "../utils.ts";
import { enqueueJob } from "./jobs.ts";
import { open, seal } from "./secrets.ts";
import { oscuPost, OscuError } from "./etims-client.ts";
import {
  OSCU_PATHS,
  assertProductionSwitch,
  buildSalesPayload,
  classifyOscuFailure,
  etimsReceiptQrUrl,
  isBranchId,
  isDeviceSerial,
  isKraPin,
  normalizeBranchId,
  normalizeKraPin,
  parseInitInfo,
  parseSaleHit,
  parseSaleSave,
  redactSecrets,
  resolveItemCodes,
  splitLineTax,
  type EtimsEnvironment,
  type EtimsCodeSet,
} from "./etims-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

type SettingsRow = {
  tenant_id: string;
  enabled: boolean;
  environment: EtimsEnvironment;
  kra_pin: string;
  branch_id: string;
  device_serial: string;
  comm_key_sealed: string;
  status: string;
  sdc_id: string;
  mrc_no: string;
  trade_name: string;
  branch_name: string;
  default_item_cd: string;
  default_item_cls_cd: string;
  default_tax_ty_cd: string;
  default_qty_unit_cd: string;
  default_pkg_unit_cd: string;
  initialized_at: string | null;
  last_success_at: string | null;
  last_error: string;
  last_error_at: string | null;
  production_confirmed_at: string | null;
  next_invc_no: number;
};

const SETTINGS_COLS = `tenant_id, enabled, environment, kra_pin, branch_id, device_serial, comm_key_sealed, status,
  sdc_id, mrc_no, trade_name, branch_name, default_item_cd, default_item_cls_cd, default_tax_ty_cd,
  default_qty_unit_cd, default_pkg_unit_cd, initialized_at::text as initialized_at,
  last_success_at::text as last_success_at, last_error, last_error_at::text as last_error_at,
  production_confirmed_at::text as production_confirmed_at, next_invc_no`;

async function audit(sql: Sql, tenantId: string, actor: string, action: string, entityId: string, details: string) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${actor || "system"}, ${action}, ${"etims"}, ${entityId}, ${details.slice(0, 500)})`;
}

async function readSettings(sql: Sql, tenantId: string) {
  const [row] = await sql.query<SettingsRow>(
    `select ${SETTINGS_COLS} from etims_settings where tenant_id = $1`,
    [tenantId],
  );
  return row ?? null;
}

export function publicEtimsSettings(row: SettingsRow | null, counts?: { pending: number; failed: number; rejected: number; submitted: number }) {
  return {
    enabled: Boolean(row?.enabled),
    environment: (row?.environment || "sandbox") as EtimsEnvironment,
    kraPin: row?.kra_pin || "",
    branchId: row?.branch_id || "",
    deviceSerial: row?.device_serial || "",
    status: row?.status || "not_initialized",
    initializedAt: row?.initialized_at || null,
    lastSuccessAt: row?.last_success_at || null,
    lastError: row?.last_error || "",
    hasKey: Boolean(row?.comm_key_sealed),
    sdcId: row?.sdc_id || "",
    mrcNo: row?.mrc_no || "",
    tradeName: row?.trade_name || "",
    branchName: row?.branch_name || "",
    defaultItemCd: row?.default_item_cd || "",
    defaultItemClsCd: row?.default_item_cls_cd || "",
    defaultTaxTyCd: row?.default_tax_ty_cd || "",
    defaultQtyUnitCd: row?.default_qty_unit_cd || "",
    defaultPkgUnitCd: row?.default_pkg_unit_cd || "",
    productionConfirmed: Boolean(row?.production_confirmed_at),
    counts: counts || { pending: 0, failed: 0, rejected: 0, submitted: 0 },
  };
}

async function countsFor(sql: Sql, tenantId: string) {
  const [row] = await sql.query<{ pending: number; failed: number; rejected: number; submitted: number }>(
    `select
       count(*) filter (where etims_status = 'pending')::int as pending,
       count(*) filter (where etims_status = 'failed')::int as failed,
       count(*) filter (where etims_status = 'rejected')::int as rejected,
       count(*) filter (where etims_status = 'submitted')::int as submitted
     from invoices where tenant_id = $1`,
    [tenantId],
  );
  return row || { pending: 0, failed: 0, rejected: 0, submitted: 0 };
}

export async function getEtimsView(sql: Sql, tenantId: string) {
  const row = await readSettings(sql, tenantId);
  const counts = await countsFor(sql, tenantId);
  const failures = await sql.query<{ id: string; number: string; etims_error: string; etims_status: string }>(
    `select id, number, etims_error, etims_status from invoices
     where tenant_id = $1 and etims_status in ('failed', 'rejected', 'pending')
     order by issued_at desc limit 8`,
    [tenantId],
  );
  return { ...publicEtimsSettings(row, counts), failures, maps: await packageMaps(sql, tenantId) };
}

export type EtimsSaveInput = {
  enabled: boolean;
  environment: EtimsEnvironment;
  kraPin: string;
  branchId: string;
  deviceSerial: string;
  defaultItemCd?: string;
  defaultItemClsCd?: string;
  defaultTaxTyCd?: string;
  defaultQtyUnitCd?: string;
  defaultPkgUnitCd?: string;
  confirmProduction?: boolean;
};

export async function saveEtimsSettings(sql: Sql, tenantId: string, actorId: string, input: EtimsSaveInput) {
  const environment = input.environment === "production" ? "production" : "sandbox";
  const pin = normalizeKraPin(input.kraPin || "");
  const branchId = normalizeBranchId(input.branchId || "");
  const deviceSerial = input.deviceSerial.trim();
  if (input.enabled) {
    if (!isKraPin(pin)) throw new Error("Enter a valid KRA PIN");
    if (!isBranchId(branchId)) throw new Error("Branch ID must be the 2-character branch registered with KRA");
    if (!isDeviceSerial(deviceSerial)) throw new Error("Enter the device serial from KRA onboarding");
  }
  const current = await readSettings(sql, tenantId);
  assertProductionSwitch(current?.environment || "sandbox", environment, Boolean(input.confirmProduction));
  const identityChanged = Boolean(
    current &&
      current.status === "initialized" &&
      (current.kra_pin !== pin || current.branch_id !== branchId || current.device_serial !== deviceSerial),
  );
  const productionAt =
    environment === "production" ? current?.production_confirmed_at || new Date().toISOString() : null;
  if (!current) {
    await sql.query(
      `insert into etims_settings (
         tenant_id, enabled, environment, kra_pin, branch_id, device_serial,
         default_item_cd, default_item_cls_cd, default_tax_ty_cd, default_qty_unit_cd, default_pkg_unit_cd,
         production_confirmed_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())`,
      [
        tenantId,
        input.enabled,
        environment,
        pin,
        branchId,
        deviceSerial,
        (input.defaultItemCd || "").trim(),
        (input.defaultItemClsCd || "").trim(),
        (input.defaultTaxTyCd || "").trim(),
        (input.defaultQtyUnitCd || "").trim(),
        (input.defaultPkgUnitCd || "").trim(),
        productionAt,
      ],
    );
  } else {
    await sql.query(
      `update etims_settings set
         enabled = $2, environment = $3, kra_pin = $4, branch_id = $5, device_serial = $6,
         default_item_cd = $7, default_item_cls_cd = $8, default_tax_ty_cd = $9,
         default_qty_unit_cd = $10, default_pkg_unit_cd = $11,
         production_confirmed_at = $12,
         status = case when $13 then 'not_initialized' else status end,
         comm_key_sealed = case when $13 then '' else comm_key_sealed end,
         initialized_at = case when $13 then null else initialized_at end,
         updated_at = now()
       where tenant_id = $1`,
      [
        tenantId,
        input.enabled,
        environment,
        pin,
        branchId,
        deviceSerial,
        (input.defaultItemCd || "").trim(),
        (input.defaultItemClsCd || "").trim(),
        (input.defaultTaxTyCd || "").trim(),
        (input.defaultQtyUnitCd || "").trim(),
        (input.defaultPkgUnitCd || "").trim(),
        productionAt,
        identityChanged,
      ],
    );
  }
  const wasEnabled = Boolean(current?.enabled);
  if (wasEnabled !== input.enabled) {
    await audit(sql, tenantId, actorId, input.enabled ? "ETIMS_ENABLED" : "ETIMS_DISABLED", tenantId, environment);
  }
  if (input.enabled) await requeuePending(sql, tenantId);
  return getEtimsView(sql, tenantId);
}

export async function initializeEtimsDevice(
  sql: Sql,
  tenantId: string,
  actorId: string,
  opts: { force?: boolean; fetchImpl?: typeof fetch } = {},
) {
  const settings = await readSettings(sql, tenantId);
  if (!settings?.enabled) throw new Error("Enable eTIMS before registering the device");
  if (!isKraPin(settings.kra_pin) || !isBranchId(settings.branch_id) || !isDeviceSerial(settings.device_serial)) {
    throw new Error("KRA PIN, branch, and device serial are required");
  }
  if (settings.status === "initialized" && settings.comm_key_sealed && !opts.force) {
    return { already: true, view: await getEtimsView(sql, tenantId) };
  }
  const locked = await sql.query<{ tenant_id: string }>(
    `update etims_settings set init_lock_at = now(), updated_at = now()
     where tenant_id = $1 and (init_lock_at is null or init_lock_at < now() - interval '2 minutes')
     returning tenant_id`,
    [tenantId],
  );
  if (!locked[0]) throw new Error("Device initialization is already running");
  await audit(sql, tenantId, actorId, "ETIMS_INITIALIZATION_STARTED", tenantId, settings.environment);
  try {
    const result = await oscuPost({
      environment: settings.environment,
      path: OSCU_PATHS.init,
      body: { tin: settings.kra_pin, bhfId: settings.branch_id, dvcSrlNo: settings.device_serial },
      fetchImpl: opts.fetchImpl,
    });
    if (result.resultCd !== "000") {
      const kind = classifyOscuFailure(result.resultCd, result.httpStatus);
      throw new Error(result.resultMsg || `KRA initialization failed (${result.resultCd || kind})`);
    }
    const info = parseInitInfo(result.data);
    if (!info) throw new Error("KRA did not return a communication key");
    await sql.query(
      `update etims_settings set
         comm_key_sealed = $2, status = 'initialized', sdc_id = $3, mrc_no = $4,
         trade_name = $5, branch_name = $6, initialized_at = now(), last_error = '',
         init_lock_at = null, updated_at = now()
       where tenant_id = $1`,
      [tenantId, seal(info.cmcKey), info.sdcId, info.mrcNo, info.tradeName, info.branchName],
    );
    await audit(sql, tenantId, actorId, "ETIMS_INITIALIZED", tenantId, settings.environment);
    return { already: false, view: await getEtimsView(sql, tenantId) };
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : "Initialization failed", []);
    await sql.query(
      `update etims_settings set status = 'error', last_error = $2, last_error_at = now(), init_lock_at = null, updated_at = now()
       where tenant_id = $1`,
      [tenantId, message],
    );
    await audit(sql, tenantId, actorId, "ETIMS_INITIALIZATION_FAILED", tenantId, message);
    throw new Error(message);
  }
}

export async function testEtimsConnection(sql: Sql, tenantId: string, fetchImpl?: typeof fetch) {
  const settings = await readSettings(sql, tenantId);
  if (!settings?.comm_key_sealed || settings.status !== "initialized") {
    return { ok: false, message: "Initialize the device before testing the connection" };
  }
  const key = open(settings.comm_key_sealed);
  try {
    const result = await oscuPost({
      environment: settings.environment,
      path: OSCU_PATHS.codes,
      body: { tin: settings.kra_pin, bhfId: settings.branch_id, lastReqDt: "20180520000000" },
      tin: settings.kra_pin,
      bhfId: settings.branch_id,
      cmcKey: key,
      fetchImpl,
    });
    if (result.resultCd !== "000") {
      return { ok: false, message: result.resultMsg || "KRA did not accept the connection test" };
    }
    return { ok: true, message: "Connection succeeded. No invoice was created." };
  } catch (err) {
    return { ok: false, message: redactSecrets(err instanceof Error ? err.message : "Connection failed", [key]) };
  }
}

export async function queueEtimsForInvoice(sql: Sql, tenantId: string, invoiceId: string) {
  if (!invoiceId) return { queued: false };
  const settings = await readSettings(sql, tenantId);
  if (!settings?.enabled) {
    await sql.query(`update invoices set etims_status = 'not_applicable' where id = $1 and tenant_id = $2 and etims_status = 'not_applicable'`, [
      invoiceId,
      tenantId,
    ]);
    return { queued: false };
  }
  await sql.query(
    `update invoices set etims_status = 'pending', etims_error = '' where id = $1 and tenant_id = $2 and etims_status <> 'submitted'`,
    [invoiceId, tenantId],
  );
  const job = await enqueueJob(sql, {
    queue: "billing",
    kind: "etims.submit",
    tenantId,
    payload: { tenantId, invoiceId },
    idempotencyKey: `etims.submit:${tenantId}:${invoiceId}`,
    maxAttempts: 6,
  });
  await audit(sql, tenantId, "system", "ETIMS_INVOICE_QUEUED", invoiceId, job.id);
  return { queued: job.queued, id: job.id };
}

async function requeuePending(sql: Sql, tenantId: string) {
  const rows = await sql.query<{ id: string }>(
    `select id from invoices where tenant_id = $1 and etims_status = 'pending' order by issued_at limit 50`,
    [tenantId],
  );
  for (const row of rows) await queueEtimsForInvoice(sql, tenantId, row.id);
}

export async function retryEtimsInvoice(sql: Sql, tenantId: string, actorId: string, invoiceId: string) {
  const [inv] = await sql.query<{ id: string; etims_status: string }>(
    `select id, etims_status from invoices where id = $1 and tenant_id = $2`,
    [invoiceId, tenantId],
  );
  if (!inv) throw new Error("Invoice not found");
  if (inv.etims_status === "submitted") throw new Error("This invoice was already submitted to KRA");
  if (inv.etims_status === "not_applicable") throw new Error("eTIMS was not enabled for this invoice");
  await sql.query(`delete from job_queue where tenant_id = $1 and idempotency_key = $2`, [
    tenantId,
    `etims.submit:${tenantId}:${invoiceId}`,
  ]);
  await sql.query(`update invoices set etims_status = 'pending', etims_error = '' where id = $1 and tenant_id = $2`, [invoiceId, tenantId]);
  await audit(sql, tenantId, actorId, "ETIMS_INVOICE_RETRY", invoiceId, "");
  return queueEtimsForInvoice(sql, tenantId, invoiceId);
}

function codesOf(row: SettingsRow): EtimsCodeSet {
  return {
    itemCd: row.default_item_cd,
    itemClsCd: row.default_item_cls_cd,
    taxTyCd: row.default_tax_ty_cd,
    qtyUnitCd: row.default_qty_unit_cd,
    pkgUnitCd: row.default_pkg_unit_cd,
  };
}

export async function submitInvoiceToEtims(sql: Sql, tenantId: string, invoiceId: string, fetchImpl?: typeof fetch) {
  const settings = await readSettings(sql, tenantId);
  const [inv] = await sql.query<{
    id: string;
    number: string;
    customer_id: string;
    etims_status: string;
    etims_invc_no: number | null;
    etims_org_invc_no: number | null;
    tax_kes: number;
    issued_at: string;
  }>(
    `select id, number, customer_id, etims_status, etims_invc_no, etims_org_invc_no, tax_kes, issued_at::text as issued_at
     from invoices where id = $1 and tenant_id = $2`,
    [invoiceId, tenantId],
  );
  if (!inv) throw new Error("Invoice not found");
  if (inv.etims_status === "submitted") return { skipped: true, reason: "already-submitted" };
  if (!settings?.enabled) return { skipped: true, reason: "disabled" };
  if (settings.status !== "initialized" || !settings.comm_key_sealed) {
    throw new Error("eTIMS device is not initialized");
  }
  if (settings.environment === "production" && !settings.production_confirmed_at) {
    throw new Error("Production eTIMS has not been confirmed");
  }
  const key = open(settings.comm_key_sealed);
  const [customer] = await sql.query<{ name: string; kra_pin: string }>(
    `select name, coalesce(kra_pin,'') as kra_pin from customers where id = $1 and tenant_id = $2`,
    [inv.customer_id, tenantId],
  );
  const items = await sql.query<{ description: string; quantity: number; unit_kes: number; amount_kes: number; package_id: string | null }>(
    `select description, quantity, unit_kes, amount_kes, package_id from invoice_items where invoice_id = $1 and tenant_id = $2 order by description`,
    [invoiceId, tenantId],
  );
  const maps = await sql.query<{ package_id: string; item_cd: string; item_cls_cd: string; tax_ty_cd: string; qty_unit_cd: string; pkg_unit_cd: string }>(
    `select package_id, item_cd, item_cls_cd, tax_ty_cd, qty_unit_cd, pkg_unit_cd from etims_item_maps where tenant_id = $1`,
    [tenantId],
  );
  const mapBy = new Map(maps.map((row) => [row.package_id, row]));
  const taxes = splitLineTax(
    items.map((item) => item.amount_kes),
    inv.tax_kes,
  );
  const lines = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    const mapped = item.package_id ? mapBy.get(item.package_id) : undefined;
    const codes = resolveItemCodes(codesOf(settings), mapped
      ? {
          itemCd: mapped.item_cd,
          itemClsCd: mapped.item_cls_cd,
          taxTyCd: mapped.tax_ty_cd,
          qtyUnitCd: mapped.qty_unit_cd,
          pkgUnitCd: mapped.pkg_unit_cd,
        }
      : null);
    if (!codes) {
      await markRejected(sql, tenantId, invoiceId, "Map each package to a KRA item code and classification before submission");
      return { rejected: true };
    }
    lines.push({
      name: item.description,
      quantity: item.quantity,
      unitKes: item.unit_kes,
      taxblKes: item.amount_kes,
      taxKes: taxes[i] || 0,
      codes,
    });
  }
  if (!lines.length) {
    await markRejected(sql, tenantId, invoiceId, "Invoice has no lines to submit");
    return { rejected: true };
  }
  let invcNo = inv.etims_invc_no;
  if (!invcNo) {
    const [allocated] = await sql.query<{ invc_no: number }>(
      `update etims_settings set next_invc_no = next_invc_no + 1, updated_at = now()
       where tenant_id = $1 returning next_invc_no - 1 as invc_no`,
      [tenantId],
    );
    invcNo = allocated?.invc_no || 1;
    await sql.query(`update invoices set etims_invc_no = $3 where id = $1 and tenant_id = $2 and etims_invc_no is null`, [
      invoiceId,
      tenantId,
      invcNo,
    ]);
  }
  const existing = await lookupSale(settings, key, invcNo, fetchImpl);
  if (existing) {
    await storeSuccess(sql, tenantId, invoiceId, settings, existing);
    return { submitted: true, recovered: true, rcptNo: existing.rcptNo };
  }
  const payload = buildSalesPayload({
    tin: settings.kra_pin,
    bhfId: settings.branch_id,
    invcNo,
    orgInvcNo: inv.etims_org_invc_no,
    traderInvoiceNo: inv.number,
    customerName: customer?.name || "Customer",
    customerPin: customer?.kra_pin,
    when: new Date(inv.issued_at),
    lines,
    actor: "isp",
  });
  let result;
  try {
    result = await oscuPost({
      environment: settings.environment,
      path: OSCU_PATHS.salesSave,
      body: payload,
      tin: settings.kra_pin,
      bhfId: settings.branch_id,
      cmcKey: key,
      fetchImpl,
    });
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : "KRA request failed", [key]);
    await sql.query(`update invoices set etims_error = $3 where id = $1 and tenant_id = $2`, [invoiceId, tenantId, message]);
    await sql.query(`update etims_settings set last_error = $2, last_error_at = now(), updated_at = now() where tenant_id = $1`, [
      tenantId,
      message,
    ]);
    throw new Error(message);
  }
  if (result.resultCd !== "000") {
    const kind = classifyOscuFailure(result.resultCd, result.httpStatus);
    const message = result.resultMsg || `KRA rejected the invoice (${result.resultCd})`;
    if (kind === "rejected") {
      await markRejected(sql, tenantId, invoiceId, message);
      return { rejected: true, message };
    }
    await sql.query(`update invoices set etims_status = 'pending', etims_error = $3 where id = $1 and tenant_id = $2`, [
      invoiceId,
      tenantId,
      message,
    ]);
    await sql.query(`update etims_settings set last_error = $2, last_error_at = now(), updated_at = now() where tenant_id = $1`, [
      tenantId,
      message,
    ]);
    throw new Error(message);
  }
  const hit = parseSaleSave(result.data, invcNo);
  if (!hit) {
    throw new Error("KRA accepted the invoice but did not return a receipt signature");
  }
  await storeSuccess(sql, tenantId, invoiceId, settings, hit);
  return { submitted: true, rcptNo: hit.rcptNo };
}

async function lookupSale(settings: SettingsRow, key: string, invcNo: number, fetchImpl?: typeof fetch) {
  let result;
  try {
    result = await oscuPost({
      environment: settings.environment,
      path: OSCU_PATHS.salesSelect,
      body: { tin: settings.kra_pin, bhfId: settings.branch_id, lastReqDt: "20180101000000", invcNo },
      tin: settings.kra_pin,
      bhfId: settings.branch_id,
      cmcKey: key,
      fetchImpl,
    });
  } catch (err) {
    if (err instanceof OscuError && err.kind === "rejected") return null;
    const message = redactSecrets(
      err instanceof Error ? err.message : "Could not verify whether KRA already accepted this invoice",
      [key],
    );
    throw new Error(message);
  }
  if (result.resultCd !== "000") {
    if (classifyOscuFailure(result.resultCd, result.httpStatus) === "transient") {
      throw new Error(result.resultMsg || "Could not verify whether KRA already accepted this invoice");
    }
    return null;
  }
  return parseSaleHit(result.data, invcNo);
}

async function storeSuccess(
  sql: Sql,
  tenantId: string,
  invoiceId: string,
  settings: SettingsRow,
  hit: { rcptNo: string; intrlData: string; rcptSign: string; sdcDateTime: string },
) {
  const qr = etimsReceiptQrUrl(settings.environment, settings.kra_pin, settings.branch_id, hit.rcptSign);
  await sql.query(
    `update invoices set etims_status = 'submitted', etims_rcpt_no = $3, etims_intrl_data = $4, etims_rcpt_sign = $5,
       etims_sdc_datetime = $6, etims_qr_url = $7, etims_submitted_at = now(), etims_error = ''
     where id = $1 and tenant_id = $2`,
    [invoiceId, tenantId, hit.rcptNo, hit.intrlData, hit.rcptSign, hit.sdcDateTime, qr],
  );
  await sql.query(`update etims_settings set last_success_at = now(), last_error = '', updated_at = now() where tenant_id = $1`, [tenantId]);
  await audit(sql, tenantId, "system", "ETIMS_INVOICE_SUBMITTED", invoiceId, hit.rcptNo);
}

async function markRejected(sql: Sql, tenantId: string, invoiceId: string, message: string) {
  const safe = redactSecrets(message, []).slice(0, 400);
  await sql.query(`update invoices set etims_status = 'rejected', etims_error = $3 where id = $1 and tenant_id = $2`, [
    invoiceId,
    tenantId,
    safe,
  ]);
  await sql.query(`update etims_settings set last_error = $2, last_error_at = now(), updated_at = now() where tenant_id = $1`, [
    tenantId,
    safe,
  ]);
  await audit(sql, tenantId, "system", "ETIMS_INVOICE_REJECTED", invoiceId, safe);
}

async function packageMaps(sql: Sql, tenantId: string) {
  const rows = await sql.query<{
    package_id: string;
    name: string;
    item_cd: string;
    item_cls_cd: string;
    tax_ty_cd: string;
    qty_unit_cd: string;
    pkg_unit_cd: string;
  }>(
    `select p.id as package_id, p.name,
            coalesce(m.item_cd, '') as item_cd,
            coalesce(m.item_cls_cd, '') as item_cls_cd,
            coalesce(m.tax_ty_cd, '') as tax_ty_cd,
            coalesce(m.qty_unit_cd, '') as qty_unit_cd,
            coalesce(m.pkg_unit_cd, '') as pkg_unit_cd
     from packages p
     left join etims_item_maps m on m.package_id = p.id and m.tenant_id = p.tenant_id
     where p.tenant_id = $1
     order by p.name
     limit 100`,
    [tenantId],
  );
  return rows.map((row) => ({
    packageId: row.package_id,
    name: row.name,
    itemCd: row.item_cd,
    itemClsCd: row.item_cls_cd,
    taxTyCd: row.tax_ty_cd,
    qtyUnitCd: row.qty_unit_cd,
    pkgUnitCd: row.pkg_unit_cd,
  }));
}

function clipCode(value: string) {
  return value.trim().slice(0, 40);
}

export async function saveEtimsPackageMaps(
  sql: Sql,
  tenantId: string,
  maps: Array<{ packageId: string; itemCd: string; itemClsCd: string; taxTyCd: string; qtyUnitCd: string; pkgUnitCd: string }>,
) {
  for (const map of maps) {
    const packageId = map.packageId.trim();
    if (!packageId) continue;
    const [pkg] = await sql.query<{ id: string }>(`select id from packages where id = $1 and tenant_id = $2`, [
      packageId,
      tenantId,
    ]);
    if (!pkg) continue;
    const itemCd = clipCode(map.itemCd || "");
    const itemClsCd = clipCode(map.itemClsCd || "");
    const taxTyCd = clipCode(map.taxTyCd || "");
    const qtyUnitCd = clipCode(map.qtyUnitCd || "");
    const pkgUnitCd = clipCode(map.pkgUnitCd || "");
    if (!itemCd && !itemClsCd && !taxTyCd && !qtyUnitCd && !pkgUnitCd) {
      await sql.query(`delete from etims_item_maps where tenant_id = $1 and package_id = $2`, [tenantId, packageId]);
      continue;
    }
    await sql.query(
      `insert into etims_item_maps (tenant_id, package_id, item_cd, item_cls_cd, tax_ty_cd, qty_unit_cd, pkg_unit_cd, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (tenant_id, package_id) do update set
         item_cd = excluded.item_cd, item_cls_cd = excluded.item_cls_cd, tax_ty_cd = excluded.tax_ty_cd,
         qty_unit_cd = excluded.qty_unit_cd, pkg_unit_cd = excluded.pkg_unit_cd, updated_at = now()`,
      [tenantId, packageId, itemCd, itemClsCd, taxTyCd, qtyUnitCd, pkgUnitCd],
    );
  }
  return getEtimsView(sql, tenantId);
}

export async function markEtimsFailed(sql: Sql, tenantId: string, invoiceId: string, message: string) {
  const safe = redactSecrets(message, []).slice(0, 400);
  const [row] = await sql.query<{ etims_status: string }>(
    `select etims_status from invoices where id = $1 and tenant_id = $2`,
    [invoiceId, tenantId],
  );
  if (!row || row.etims_status === "submitted" || row.etims_status === "rejected" || row.etims_status === "not_applicable") return;
  await sql.query(`update invoices set etims_status = 'failed', etims_error = $3 where id = $1 and tenant_id = $2`, [
    invoiceId,
    tenantId,
    safe,
  ]);
  await sql.query(`update etims_settings set last_error = $2, last_error_at = now(), updated_at = now() where tenant_id = $1`, [
    tenantId,
    safe,
  ]);
  await audit(sql, tenantId, "system", "ETIMS_INVOICE_FAILED", invoiceId, safe);
}
