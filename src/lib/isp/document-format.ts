export type BrandProfile = {
  tenantId: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxPin: string;
  vatEnabled: boolean;
  vatRate: number;
  currency: string;
  timezone: string;
  footer: string;
  notes: string;
  brandColor: string;
  logo?: string;
  bankName: string;
  bankAccount: string;
  bankBranch: string;
  paymentMethods: Array<{ label: string; detail: string }>;
};

export type InvoiceLine = {
  description: string;
  packageName: string;
  period: string;
  quantity: number;
  unit: number;
  discount: number;
  tax: number;
  total: number;
};

export type InvoiceDocument = {
  kind: "invoice";
  brand: BrandProfile;
  invoice: {
    id: string;
    number: string;
    status: string;
    statusLabel: string;
    issuedAt: string;
    dueDate: string;
    notes: string;
  };
  customer: {
    id: string;
    name: string;
    accountNo: string;
    phone: string;
    email: string;
    address: string;
  };
  lines: InvoiceLine[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    taxRate: number;
    previousBalance: number;
    payments: number;
    amountDue: number;
    totalPayable: number;
    creditBalance: number;
  };
  payments: Array<{ provider: string; reference: string; amount: number; paidAt: string }>;
};

export type StatementRow = {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  kind: string;
};

export type StatementDocument = {
  kind: "statement";
  brand: BrandProfile;
  customer: {
    id: string;
    name: string;
    accountNo: string;
    phone: string;
    email: string;
    address: string;
  };
  periodStart: string;
  periodEnd: string;
  statementDate: string;
  rows: StatementRow[];
  summary: {
    opening: number;
    invoices: number;
    payments: number;
    credits: number;
    adjustments: number;
    closing: number;
  };
};

const DEFAULT_COLOR = "#4aa8a0";

export function accountNumber(slug: string, customerId: string) {
  const pre = slug.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "ACC";
  const tail = customerId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || "000000";
  return `${pre}-${tail}`;
}

/** Prefer the stored ISP-assigned number; fall back to the derived slug code. */
export function resolveAccountNumber(slug: string, customerId: string, stored?: string | null) {
  const n = (stored || "").trim();
  if (n) return n;
  return accountNumber(slug, customerId);
}


export function invoiceStatusLabel(status: string) {
  const map: Record<string, string> = {
    draft: "Draft",
    pending: "Pending",
    issued: "Sent",
    due: "Pending",
    sent: "Sent",
    paid: "Paid",
    partial: "Partially Paid",
    overdue: "Overdue",
    cancelled: "Cancelled",
    canceled: "Cancelled",
    void: "Void",
  };
  return map[status.toLowerCase()] ?? status.replace(/_/g, " ");
}

export function invoiceStatusTone(label: string): "ok" | "warn" | "danger" | "muted" {
  const s = label.toLowerCase();
  if (s.includes("paid") && !s.includes("partial")) return "ok";
  if (s.includes("overdue") || s.includes("void") || s.includes("cancel")) return "danger";
  if (s.includes("partial") || s.includes("pending") || s.includes("sent")) return "warn";
  return "muted";
}

export function formatMoney(amount: number, currency = "KES") {
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: currency || "KES",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString("en-KE")}`;
  }
}

export function formatDay(iso: string, timeZone = "Africa/Nairobi") {
  const raw = iso.length <= 10 ? `${iso.slice(0, 10)}T12:00:00Z` : iso;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone }).format(d);
}

export function parseBrandColor(hex: string) {
  const h = (hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    const fallback = DEFAULT_COLOR.slice(1);
    return {
      hex: DEFAULT_COLOR,
      rgb: [parseInt(fallback.slice(0, 2), 16), parseInt(fallback.slice(2, 4), 16), parseInt(fallback.slice(4, 6), 16)] as [
        number,
        number,
        number,
      ],
    };
  }
  return {
    hex: `#${h.toLowerCase()}`,
    rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as [number, number, number],
  };
}

export function brandInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "ISP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function buildStatementRows(
  entries: Array<{
    created_at: string;
    entry_type: string;
    debit_kes: number;
    credit_kes: number;
    memo: string;
    ref_id?: string;
  }>,
  opening = 0,
): { rows: StatementRow[]; summary: StatementDocument["summary"] } {
  let running = opening;
  let invoices = 0;
  let payments = 0;
  let credits = 0;
  let adjustments = 0;
  const rows: StatementRow[] = [];
  for (const e of entries) {
    const debit = Math.max(0, e.debit_kes || 0);
    const credit = Math.max(0, e.credit_kes || 0);
    running += debit - credit;
    const kind = (e.entry_type || "adjustment").toLowerCase();
    if (kind === "invoice") invoices += debit;
    else if (kind === "payment") payments += credit;
    else if (kind === "credit") credits += credit;
    else {
      adjustments += debit;
      credits += credit;
    }
    rows.push({
      date: e.created_at,
      reference: e.memo || e.ref_id || kind,
      description: describeLedger(kind, e.memo),
      debit,
      credit,
      balance: running,
      kind,
    });
  }
  return {
    rows,
    summary: { opening, invoices, payments, credits, adjustments, closing: running },
  };
}

function describeLedger(kind: string, memo: string) {
  if (kind === "invoice") return memo ? `Invoice ${memo}` : "Invoice";
  if (kind === "payment") return memo ? `Payment ${memo}` : "Payment";
  if (kind === "credit") return memo ? `Credit ${memo}` : "Credit";
  return memo || "Adjustment";
}

export function invoicePayable(previousBalance: number, amountDue: number) {
  const net = previousBalance + amountDue;
  return {
    totalPayable: Math.max(0, net),
    creditBalance: net < 0 ? Math.abs(net) : 0,
  };
}
