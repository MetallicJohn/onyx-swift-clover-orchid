/** KRA eTIMS OSCU adapter types. Invoice domain stays separate from this payload model. */

export const ETIMS_ENVIRONMENTS = ["sandbox", "production"] as const;
export type EtimsEnvironment = (typeof ETIMS_ENVIRONMENTS)[number];

export const OSCU_BASE = {
  sandbox: "https://etims-api-sbx.kra.go.ke/etims-api",
  production: "https://etims-api.kra.go.ke/etims-api",
} as const;

/** Paths from the KRA OSCU specification (device init and sales). */
export const OSCU_PATHS = {
  init: "/selectInitOsdcInfo",
  codes: "/selectCodeList",
  itemClass: "/selectItemClsList",
  salesSave: "/saveTrnsSalesOsdc",
  salesSelect: "/selectTrnsSalesList",
} as const;

export type EtimsStatus = "not_applicable" | "pending" | "submitted" | "rejected" | "failed";

const PIN_RE = /^[A-Z][0-9]{9}[A-Z]$/;

export function isKraPin(value: string) {
  return PIN_RE.test(value.trim().toUpperCase());
}

export function normalizeKraPin(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeBranchId(value: string) {
  return value.trim();
}

export function isBranchId(value: string) {
  return /^[A-Za-z0-9]{2}$/.test(value.trim());
}

export function isDeviceSerial(value: string) {
  const serial = value.trim();
  return serial.length > 0 && serial.length <= 100;
}

export function oscuBaseUrl(environment: EtimsEnvironment) {
  return OSCU_BASE[environment];
}

/** Nairobi timestamp KRA expects: yyyyMMddHHmmss. */
export function kraStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

export function classifyOscuFailure(resultCd: string, httpStatus: number): "rejected" | "transient" {
  if (httpStatus === 0 || httpStatus >= 500) return "transient";
  if (resultCd === "001") return "transient";
  if (resultCd.startsWith("9") || (httpStatus >= 400 && httpStatus < 500)) return "rejected";
  return "transient";
}

export type OscuInfo = {
  cmcKey: string;
  tradeName: string;
  branchName: string;
  sdcId: string;
  mrcNo: string;
};

export function parseInitInfo(data: unknown): OscuInfo | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const info = (root.info && typeof root.info === "object" ? root.info : root) as Record<string, unknown>;
  const cmcKey = String(info.cmcKey || "").trim();
  if (!cmcKey) return null;
  return {
    cmcKey,
    tradeName: String(info.tradeNm || info.taxprNm || ""),
    branchName: String(info.bhfNm || ""),
    sdcId: String(info.sdcId || ""),
    mrcNo: String(info.mrcNo || ""),
  };
}

export type OscuSaleHit = {
  rcptNo: string;
  intrlData: string;
  rcptSign: string;
  sdcDateTime: string;
};

export function parseSaleHit(data: unknown, invcNo: number): OscuSaleHit | null {
  const hits: OscuSaleHit[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const row = node as Record<string, unknown>;
    const sign = String(row.rcptSign || "").trim();
    const rawNo = row.invcNo;
    if (sign && rawNo != null && Number(rawNo) === invcNo) {
      hits.push({
        rcptNo: String(row.totRcptNo || row.curRcptNo || row.rcptNo || invcNo),
        intrlData: String(row.intrlData || ""),
        rcptSign: sign,
        sdcDateTime: String(row.sdcDateTime || row.vsdcRcptPbctDate || ""),
      });
    }
    for (const value of Object.values(row)) walk(value);
  };
  walk(data);
  return hits.find((hit) => hit.rcptSign) ?? null;
}

export function parseSaleSave(data: unknown, invcNo: number): OscuSaleHit | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const sign = String(row.rcptSign || "").trim();
  if (!sign) return parseSaleHit(data, invcNo);
  return {
    rcptNo: String(row.totRcptNo || row.curRcptNo || row.rcptNo || invcNo),
    intrlData: String(row.intrlData || ""),
    rcptSign: sign,
    sdcDateTime: String(row.sdcDateTime || row.vsdcRcptPbctDate || ""),
  };
}

/**
 * KRA receipt verification link. Data is PIN + branch + the signature KRA returned.
 * No QR is produced unless that signature exists.
 */
export function etimsReceiptQrUrl(environment: EtimsEnvironment, pin: string, branchId: string, rcptSign: string) {
  const sign = rcptSign.trim();
  const tin = normalizeKraPin(pin);
  const branch = branchId.trim();
  if (!sign || !isKraPin(tin) || !branch) return "";
  const host = environment === "production" ? "etims.kra.go.ke" : "etims-sbx.kra.go.ke";
  const data = `${tin}${branch}${sign}`;
  return `https://${host}/common/link/etims/receipt/indexEtimsReceiptData?Data=${encodeURIComponent(data)}`;
}

export type EtimsCodeSet = {
  itemCd: string;
  itemClsCd: string;
  taxTyCd: string;
  qtyUnitCd: string;
  pkgUnitCd: string;
};

export function resolveItemCodes(fallback: EtimsCodeSet, override?: Partial<EtimsCodeSet> | null): EtimsCodeSet | null {
  const codes: EtimsCodeSet = {
    itemCd: (override?.itemCd || fallback.itemCd).trim(),
    itemClsCd: (override?.itemClsCd || fallback.itemClsCd).trim(),
    taxTyCd: (override?.taxTyCd || fallback.taxTyCd).trim(),
    qtyUnitCd: (override?.qtyUnitCd || fallback.qtyUnitCd).trim(),
    pkgUnitCd: (override?.pkgUnitCd || fallback.pkgUnitCd).trim(),
  };
  if (!codes.itemCd || !codes.itemClsCd || !codes.taxTyCd || !codes.qtyUnitCd || !codes.pkgUnitCd) return null;
  return codes;
}

export type SalesLineInput = {
  name: string;
  quantity: number;
  unitKes: number;
  taxblKes: number;
  taxKes: number;
  codes: EtimsCodeSet;
};

export function buildSalesPayload(input: {
  tin: string;
  bhfId: string;
  invcNo: number;
  orgInvcNo?: number | null;
  traderInvoiceNo: string;
  customerName: string;
  customerPin?: string;
  when?: Date;
  lines: SalesLineInput[];
  actor: string;
}) {
  const when = input.when ?? new Date();
  const stamp = kraStamp(when);
  const custTin = input.customerPin && isKraPin(input.customerPin) ? normalizeKraPin(input.customerPin) : "";
  const buckets = { A: 0, B: 0, C: 0, D: 0, E: 0 } as Record<string, number>;
  const taxBuckets = { A: 0, B: 0, C: 0, D: 0, E: 0 } as Record<string, number>;
  const rates = { A: 0, B: 0, C: 0, D: 0, E: 0 } as Record<string, number>;
  const itemList = input.lines.map((line, index) => {
    const code = line.codes.taxTyCd.toUpperCase();
    if (code in buckets) {
      buckets[code] += line.taxblKes;
      taxBuckets[code] += line.taxKes;
      if (line.taxblKes > 0) rates[code] = Math.round((line.taxKes / line.taxblKes) * 100);
    }
    const tot = line.taxblKes + line.taxKes;
    return {
      itemSeq: index + 1,
      itemCd: line.codes.itemCd,
      itemClsCd: line.codes.itemClsCd,
      itemNm: line.name.slice(0, 200),
      bcd: null,
      pkgUnitCd: line.codes.pkgUnitCd,
      pkg: 1,
      qtyUnitCd: line.codes.qtyUnitCd,
      qty: line.quantity,
      prc: line.unitKes,
      splyAmt: line.taxblKes,
      dcRt: 0,
      dcAmt: 0,
      taxTyCd: line.codes.taxTyCd,
      taxblAmt: line.taxblKes,
      taxAmt: line.taxKes,
      totAmt: tot,
    };
  });
  const totTaxblAmt = input.lines.reduce((sum, line) => sum + line.taxblKes, 0);
  const totTaxAmt = input.lines.reduce((sum, line) => sum + line.taxKes, 0);
  const totAmt = totTaxblAmt + totTaxAmt;
  const actor = input.actor.slice(0, 20) || "staff";
  return {
    tin: normalizeKraPin(input.tin),
    bhfId: input.bhfId,
    invcNo: input.invcNo,
    orgInvcNo: input.orgInvcNo && input.orgInvcNo > 0 ? input.orgInvcNo : 0,
    trdInvcNo: input.traderInvoiceNo,
    custTin,
    custNm: input.customerName.slice(0, 60),
    salesTyCd: "N",
    rcptTyCd: input.orgInvcNo && input.orgInvcNo > 0 ? "R" : "S",
    pmtTyCd: "01",
    salesSttsCd: "02",
    cfmDt: stamp,
    salesDt: stamp.slice(0, 8),
    totItemCnt: itemList.length,
    taxblAmtA: buckets.A,
    taxblAmtB: buckets.B,
    taxblAmtC: buckets.C,
    taxblAmtD: buckets.D,
    taxblAmtE: buckets.E,
    taxRtA: rates.A,
    taxRtB: rates.B,
    taxRtC: rates.C,
    taxRtD: rates.D,
    taxRtE: rates.E,
    taxAmtA: taxBuckets.A,
    taxAmtB: taxBuckets.B,
    taxAmtC: taxBuckets.C,
    taxAmtD: taxBuckets.D,
    taxAmtE: taxBuckets.E,
    totTaxblAmt,
    totTaxAmt,
    totAmt,
    prchrAcptcYn: "N",
    regrId: actor,
    regrNm: actor,
    modrId: actor,
    modrNm: actor,
    receipt: {
      custTin,
      rcptPbctDt: stamp,
      trdeNm: "",
      adrs: "",
      topMsg: "Thank you",
      btmMsg: "",
      prchrAcptcYn: "N",
    },
    itemList,
  };
}

export function splitLineTax(amounts: number[], taxTotal: number) {
  const base = amounts.reduce((sum, amount) => sum + amount, 0);
  if (base <= 0 || taxTotal <= 0) return amounts.map(() => 0);
  const taxes = amounts.map((amount) => Math.round((amount / base) * taxTotal));
  const drift = taxTotal - taxes.reduce((sum, tax) => sum + tax, 0);
  if (taxes.length) taxes[taxes.length - 1] = (taxes[taxes.length - 1] ?? 0) + drift;
  return taxes;
}

export function assertProductionSwitch(current: EtimsEnvironment, next: EtimsEnvironment, confirmed: boolean) {
  if (next === "production" && current !== "production" && !confirmed) {
    throw new Error("Confirm production before invoices are sent to KRA's live environment");
  }
}

export function etimsHealth(input: {
  enabled: boolean;
  status: string;
  lastError: string;
  lastSuccessAt: string | null;
}) {
  if (!input.enabled) return { tone: "muted" as const, title: "Off", detail: "eTIMS is not enabled for this ISP" };
  if (input.status === "initialized" && input.lastError) {
    return { tone: "danger" as const, title: "Error", detail: input.lastError };
  }
  if (input.status === "initialized") {
    return { tone: "ok" as const, title: "Connected", detail: "Device initialized" };
  }
  if (input.status === "error" || input.lastError) {
    return { tone: "danger" as const, title: "Error", detail: input.lastError || "Initialization failed" };
  }
  return { tone: "warn" as const, title: "Action required", detail: "Device has not been initialized" };
}

/** Customer-facing KRA fields. Pending, failed, and rejected invoices return null. */
export function etimsCustomerFields(row: {
  status: string;
  rcptNo: string;
  qrUrl: string;
  signature: string;
} | null | undefined) {
  if (!row || row.status !== "submitted") return null;
  const invoiceNo = row.rcptNo.trim();
  const qrUrl = row.qrUrl.trim();
  const signature = row.signature.trim();
  if (!invoiceNo || !qrUrl || !signature) return null;
  return { invoiceNo, qrUrl, signature };
}

export function redactSecrets(message: string, secrets: string[]) {
  let out = message;
  for (const secret of secrets) {
    if (secret && secret.length > 4) out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/("cmcKey"\s*:\s*")[^"]+"/gi, '$1[redacted]"');
  out = out.replace(/\bcmcKey\b\s*[:=]\s*\S+/gi, "cmcKey=[redacted]");
  return out.slice(0, 400);
}
