import { remainingKes, taxOn } from "./billing.ts";
import {
  resolveAccountNumber,
  buildStatementRows,
  formatDay,
  invoicePayable,
  invoiceStatusLabel,
  type BrandProfile,
  type InvoiceDocument,
  type InvoiceLine,
  type StatementDocument,
} from "./document-format.ts";
import { normalizeDateFormat } from "./display.ts";
import { customerBalance, serviceBalance } from "./ledger.ts";
import { DEFAULT_APPEARANCE, DEFAULT_PRESET, isAppearance, isPresetId } from "../theme/presets.ts";
import { resolvePalette } from "../theme/resolve.ts";

export type {
  BrandProfile,
  InvoiceDocument,
  InvoiceLine,
  StatementDocument,
  StatementRow,
} from "./document-format.ts";
export {
  accountNumber,
  brandInitials,
  buildStatementRows,
  formatDay,
  formatMoney,
  invoicePayable,
  invoiceStatusLabel,
  invoiceStatusTone,
  parseBrandColor,
} from "./document-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const DEFAULT_COLOR = "#4aa8a0";

async function loadBrand(sql: Sql, tenantId: string): Promise<BrandProfile> {
  const [ten] = await sql<{
    name: string;
    slug: string;
    address: string;
    support_phone: string;
    support_email: string;
    website: string;
    tax_pin: string;
    vat_enabled: boolean;
    vat_rate_pct: number;
    currency: string;
    timezone: string;
    date_format: string;
    invoice_footer: string;
    invoice_notes: string;
    brand_color: string;
    theme_preset: string;
    theme_appearance: string;
    theme_primary: string;
    theme_secondary: string;
    theme_accent: string;
    theme_display_name: string;
    theme_logo: string;
    bank_name: string;
    bank_account: string;
    bank_branch: string;
  }>`select name, slug, coalesce(address,'') as address, support_phone, support_email,
            coalesce(website,'') as website, coalesce(tax_pin,'') as tax_pin,
            vat_enabled, vat_rate_pct, currency, timezone,
            coalesce(date_format, 'dd/mm/yy') as date_format,
            coalesce(invoice_footer,'') as invoice_footer, coalesce(invoice_notes,'') as invoice_notes,
            coalesce(brand_color,'') as brand_color,
            coalesce(theme_preset,'teal') as theme_preset,
            coalesce(theme_appearance,'dark') as theme_appearance,
            coalesce(theme_primary,'') as theme_primary,
            coalesce(theme_secondary,'') as theme_secondary,
            coalesce(theme_accent,'') as theme_accent,
            coalesce(theme_display_name,'') as theme_display_name,
            coalesce(theme_logo,'') as theme_logo,
            coalesce(bank_name,'') as bank_name, coalesce(bank_account,'') as bank_account,
            coalesce(bank_branch,'') as bank_branch
     from tenants where id = ${tenantId}`;
  if (!ten) throw new Error("Workspace not found");
  const providers = await sql<{ kind: string; label: string; enabled: boolean; till_number: string; stk_type: string }>`
    select kind, label, enabled, coalesce(till_number,'') as till_number, coalesce(stk_type,'') as stk_type
    from payment_providers where tenant_id = ${tenantId} and enabled = true`;
  const paymentMethods: Array<{ label: string; detail: string }> = [];
  for (const p of providers) {
    if (p.kind === "mpesa") {
      const mode = p.stk_type === "till" ? "Till" : "Paybill";
      paymentMethods.push({
        label: p.till_number ? `M-Pesa ${mode}` : "M-Pesa",
        detail: p.till_number ? `${mode} ${p.till_number}` : "Use the paybill or till issued by this network.",
      });
    } else if (p.kind === "kopokopo") {
      paymentMethods.push({
        label: "Kopo Kopo",
        detail: p.till_number ? `Till ${p.till_number}` : p.label,
      });
    } else {
      paymentMethods.push({ label: p.label || p.kind, detail: p.till_number || p.kind });
    }
  }
  if (ten.bank_name && ten.bank_account) {
    paymentMethods.push({
      label: "Bank transfer",
      detail: [ten.bank_name, ten.bank_account, ten.bank_branch].filter(Boolean).join(" · "),
    });
  }
  return {
    tenantId,
    name: ten.theme_display_name.trim() || ten.name,
    slug: ten.slug,
    address: ten.address,
    phone: ten.support_phone,
    email: ten.support_email,
    website: ten.website,
    taxPin: ten.tax_pin,
    vatEnabled: Boolean(ten.vat_enabled),
    vatRate: ten.vat_rate_pct || 0,
    currency: ten.currency || "KES",
    timezone: ten.timezone || "Africa/Nairobi",
    dateFormat: normalizeDateFormat(ten.date_format),
    footer: ten.invoice_footer,
    notes: ten.invoice_notes,
    brandColor: resolvePalette(
      {
        preset: isPresetId(ten.theme_preset) ? ten.theme_preset : DEFAULT_PRESET,
        appearance: isAppearance(ten.theme_appearance) ? ten.theme_appearance : DEFAULT_APPEARANCE,
        primary: ten.theme_primary,
        secondary: ten.theme_secondary,
        accent: ten.theme_accent,
      },
      true,
    ).primary || ten.brand_color || DEFAULT_COLOR,
    logo: ten.theme_logo || "",
    bankName: ten.bank_name,
    bankAccount: ten.bank_account,
    bankBranch: ten.bank_branch,
    paymentMethods,
  };
}

export async function loadInvoiceDocument(sql: Sql, tenantId: string, invoiceId: string): Promise<InvoiceDocument> {
  const brand = await loadBrand(sql, tenantId);
  const [inv] = await sql<{
    id: string;
    customer_id: string;
    service_id: string | null;
    number: string;
    amount_kes: number;
    subtotal_kes: number;
    tax_kes: number;
    tax_rate: number;
    paid_kes: number;
    status: string;
    due_date: string;
    issued_at: string;
    notes: string;
  }>`select id, customer_id, service_id, number, amount_kes, subtotal_kes, tax_kes, tax_rate, paid_kes, status,
            due_date::text as due_date, issued_at::text as issued_at, coalesce(notes,'') as notes
     from invoices where id = ${invoiceId} and tenant_id = ${tenantId}`;
  if (!inv) throw new Error("Invoice not found");
  const [customer] = await sql<{ id: string; name: string; phone: string; email: string; address: string; account_number: string }>`
    select id, name, phone, email, address, coalesce(account_number,'') as account_number from customers where id = ${inv.customer_id} and tenant_id = ${tenantId}`;
  if (!customer) throw new Error("Customer not found");

  const items = await sql<{
    description: string;
    quantity: number;
    unit_kes: number;
    amount_kes: number;
    package_id: string | null;
    service_id: string | null;
  }>`select description, quantity, unit_kes, amount_kes, package_id, service_id
     from invoice_items where invoice_id = ${inv.id} and tenant_id = ${tenantId} order by description`;

  const pkgIds = [...new Set(items.map((i) => i.package_id).filter(Boolean))] as string[];
  const svcIds = [...new Set(items.map((i) => i.service_id).filter(Boolean))] as string[];
  const packages = pkgIds.length
    ? await sql<{ id: string; name: string; billing_interval: string }>`
        select id, name, billing_interval from packages where tenant_id = ${tenantId}`
    : [];
  const services = svcIds.length
    ? await sql<{ id: string; period_end: string | null; account_number: string; name: string; status: string }>`
        select s.id, s.period_end::text as period_end, coalesce(s.account_number,'') as account_number,
               coalesce(nullif(s.name,''), p.name) as name, s.status
        from services s join packages p on p.id = s.package_id
        where s.tenant_id = ${tenantId}`
    : [];
  const pkgBy = new Map(packages.map((p) => [p.id, p]));
  const svcBy = new Map(services.map((s) => [s.id, s]));

  const taxRate = inv.tax_rate || 0;
  const lines: InvoiceLine[] =
    items.length > 0
      ? items.map((item) => {
          const pkg = item.package_id ? pkgBy.get(item.package_id) : undefined;
          const svc = item.service_id ? svcBy.get(item.service_id) : undefined;
          const lineTax = taxOn(item.amount_kes, taxRate);
          return {
            description: item.description,
            packageName: pkg?.name || "",
            period: billingPeriod(svc?.period_end ?? inv.issued_at, pkg?.billing_interval || "monthly", brand),
            quantity: item.quantity,
            unit: item.unit_kes,
            discount: 0,
            tax: lineTax,
            total: item.amount_kes,
          };
        })
      : [
          {
            description: "Internet service",
            packageName: "",
            period: billingPeriod(inv.issued_at, "monthly", brand),
            quantity: 1,
            unit: inv.subtotal_kes || inv.amount_kes,
            discount: 0,
            tax: inv.tax_kes,
            total: inv.subtotal_kes || inv.amount_kes,
          },
        ];

  const payments = await sql<{ provider: string; reference: string; amount_kes: number; paid_at: string; status: string }>`
    select provider, reference, amount_kes, paid_at::text as paid_at, status
    from payments where tenant_id = ${tenantId} and invoice_id = ${inv.id} and status = 'confirmed'
    order by paid_at`;

  const remaining = remainingKes(inv.amount_kes, inv.paid_kes, inv.status);
  const headerServiceId = inv.service_id || (svcIds.length === 1 ? svcIds[0] : "") || "";
  const billed = headerServiceId ? svcBy.get(headerServiceId) : undefined;
  let previousBalance = 0;
  let creditLimit = 0;
  let outstandingCredit = 0;
  let availableCredit = 0;
  if (headerServiceId) {
    outstandingCredit = await serviceBalance(sql, tenantId, headerServiceId);
    previousBalance = outstandingCredit - remaining;
    try {
      const { describeServiceCredit } = await import("./business-credit.ts");
      const desc = await describeServiceCredit(sql, tenantId, headerServiceId);
      if (desc?.effective.configured) {
        creditLimit = desc.effective.max_kes;
        outstandingCredit = desc.snapshot.outstanding_kes;
        availableCredit = desc.snapshot.available_kes;
        previousBalance = Math.max(0, outstandingCredit - remaining);
      }
    } catch {
      /* credit lines are optional on the invoice */
    }
  } else {
    const ledger = await customerBalance(sql, tenantId, customer.id);
    previousBalance = ledger - remaining;
  }
  const payable = invoicePayable(previousBalance, remaining);
  const accountNo = billed?.account_number
    ? billed.account_number
    : resolveAccountNumber(brand.slug, customer.id, customer.account_number);

  return {
    kind: "invoice",
    brand,
    invoice: {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      statusLabel: invoiceStatusLabel(inv.status),
      issuedAt: inv.issued_at,
      dueDate: inv.due_date,
      notes: inv.notes || brand.notes,
    },
    customer: {
      id: customer.id,
      name: customer.name,
      accountNo,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      serviceName: billed?.name || "",
      serviceStatus: billed?.status || "",
    },
    lines,
    totals: {
      subtotal: inv.subtotal_kes || lines.reduce((s, l) => s + l.total, 0),
      discount: 0,
      tax: inv.tax_kes,
      taxRate,
      previousBalance,
      payments: inv.paid_kes,
      amountDue: remaining,
      totalPayable: payable.totalPayable,
      creditBalance: payable.creditBalance,
      creditLimit,
      outstandingCredit,
      availableCredit,
    },
    payments: payments.map((p) => ({
      provider: p.provider,
      reference: p.reference,
      amount: p.amount_kes,
      paidAt: p.paid_at,
    })),
  };
}

function billingPeriod(endIso: string, interval: string, brand: Pick<BrandProfile, "timezone" | "dateFormat">) {
  const tz = brand.timezone || "Africa/Nairobi";
  const fmt = brand.dateFormat;
  const end = new Date(endIso.length <= 10 ? `${endIso}T12:00:00+03:00` : endIso);
  if (Number.isNaN(end.getTime())) return formatDay(endIso, tz, fmt);
  const start = new Date(end);
  if (interval === "daily") start.setUTCDate(start.getUTCDate() - 1);
  else if (interval === "weekly") start.setUTCDate(start.getUTCDate() - 7);
  else if (interval === "quarterly") start.setUTCDate(start.getUTCDate() - 90);
  else if (interval === "yearly") start.setUTCDate(start.getUTCDate() - 365);
  else start.setUTCDate(start.getUTCDate() - 30);
  return `${formatDay(start.toISOString(), tz, fmt)} – ${formatDay(end.toISOString(), tz, fmt)}`;
}

export async function loadStatementDocument(
  sql: Sql,
  tenantId: string,
  customerId: string,
  serviceId?: string,
): Promise<StatementDocument> {
  const brand = await loadBrand(sql, tenantId);
  const [customer] = await sql<{ id: string; name: string; phone: string; email: string; address: string; account_number: string }>`
    select id, name, phone, email, address, coalesce(account_number,'') as account_number from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  if (!customer) throw new Error("Customer not found");
  const [svc] = serviceId
    ? await sql<{ id: string; account_number: string; name: string }>`
        select s.id, coalesce(s.account_number,'') as account_number, coalesce(nullif(s.name,''), p.name) as name
        from services s join packages p on p.id = s.package_id
        where s.id = ${serviceId} and s.tenant_id = ${tenantId} and s.customer_id = ${customerId}`
    : [];
  const ledger = serviceId
    ? await sql<{
        created_at: string;
        entry_type: string;
        debit_kes: number;
        credit_kes: number;
        memo: string;
        ref_id: string;
        service_id: string | null;
      }>`select created_at::text as created_at, entry_type, debit_kes, credit_kes, memo, coalesce(ref_id,'') as ref_id, service_id
         from customer_ledger
         where tenant_id = ${tenantId} and customer_id = ${customerId} and service_id = ${serviceId}
         order by created_at asc, id asc`
    : await sql<{
        created_at: string;
        entry_type: string;
        debit_kes: number;
        credit_kes: number;
        memo: string;
        ref_id: string;
        service_id: string | null;
      }>`select created_at::text as created_at, entry_type, debit_kes, credit_kes, memo, coalesce(ref_id,'') as ref_id, service_id
         from customer_ledger
         where tenant_id = ${tenantId} and customer_id = ${customerId}
         order by created_at asc, id asc`;
  const serviceNames = await sql<{ id: string; account_number: string; name: string }>`
    select s.id, coalesce(s.account_number,'') as account_number, coalesce(nullif(s.name,''), p.name) as name
    from services s join packages p on p.id = s.package_id
    where s.tenant_id = ${tenantId} and s.customer_id = ${customerId}`;
  const byId = new Map(serviceNames.map((s) => [s.id, s]));
  const labelled = ledger.map((row) => {
    const svcRow = row.service_id ? byId.get(row.service_id) : undefined;
    const tag = svcRow ? `${svcRow.name} · ${svcRow.account_number || "no account"}` : "";
    return {
      ...row,
      memo: tag && row.memo && !row.memo.includes(tag) ? `${row.memo} (${tag})` : tag || row.memo,
    };
  });
  const built = buildStatementRows(labelled, 0);
  const first = ledger[0]?.created_at ?? new Date().toISOString();
  const last = ledger[ledger.length - 1]?.created_at ?? new Date().toISOString();
  return {
    kind: "statement",
    brand,
    customer: {
      id: customer.id,
      name: customer.name,
      accountNo: svc?.account_number || resolveAccountNumber(brand.slug, customer.id, customer.account_number),
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      serviceName: svc?.name || "",
    },
    periodStart: first,
    periodEnd: last,
    statementDate: new Date().toISOString(),
    rows: built.rows,
    summary: built.summary,
  };
}

export { loadBrand };
