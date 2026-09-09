import { queueEmail, writeInbox } from "../inbox.ts";
import { loadInvoiceDocument, loadStatementDocument } from "../documents.ts";
import { renderInvoicePdf } from "./invoice.ts";
import { renderStatementPdf } from "./statement.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

function fileSafe(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "document";
}

export async function makeInvoicePdf(sql: Sql, tenantId: string, invoiceId: string) {
  const doc = await loadInvoiceDocument(sql, tenantId, invoiceId);
  const pdf = await renderInvoicePdf(doc);
  return {
    doc,
    pdf,
    filename: `${fileSafe(doc.brand.slug)}-${fileSafe(doc.invoice.number)}.pdf`,
  };
}

export async function makeStatementPdf(sql: Sql, tenantId: string, customerId: string) {
  const doc = await loadStatementDocument(sql, tenantId, customerId);
  const pdf = await renderStatementPdf(doc);
  return {
    doc,
    pdf,
    filename: `${fileSafe(doc.brand.slug)}-statement-${fileSafe(doc.customer.accountNo)}.pdf`,
  };
}

export async function emailInvoice(sql: Sql, tenantId: string, invoiceId: string, to?: string) {
  const { doc, pdf, filename } = await makeInvoicePdf(sql, tenantId, invoiceId);
  const dest = (to || doc.customer.email || "").trim();
  if (!dest.includes("@")) throw new Error("Customer has no email address");
  const subject = `${doc.brand.name} invoice ${doc.invoice.number}`;
  const due =
    doc.totals.creditBalance > 0
      ? `Credit balance ${doc.totals.creditBalance} ${doc.brand.currency}.`
      : `Amount due ${doc.totals.totalPayable} ${doc.brand.currency}.`;
  const body = [
    `Hello ${doc.customer.name},`,
    "",
    `Please find invoice ${doc.invoice.number} from ${doc.brand.name} attached.`,
    due,
    `Account ${doc.customer.accountNo}.`,
    doc.brand.phone || doc.brand.email ? `Contact ${[doc.brand.phone, doc.brand.email].filter(Boolean).join(" · ")}.` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  const result = await queueEmail(sql, tenantId, dest, subject, body, {
    attachments: [{ filename, content: pdf.toString("base64"), contentType: "application/pdf" }],
  });
  await writeInbox(sql, tenantId, doc.customer.id, subject, body, "invoice.emailed");
  return { ...result, to: dest, filename };
}

export async function emailStatement(sql: Sql, tenantId: string, customerId: string, to?: string) {
  const { doc, pdf, filename } = await makeStatementPdf(sql, tenantId, customerId);
  const dest = (to || doc.customer.email || "").trim();
  if (!dest.includes("@")) throw new Error("Customer has no email address");
  const closing =
    doc.summary.closing < 0
      ? `Credit balance ${Math.abs(doc.summary.closing)} ${doc.brand.currency}.`
      : `Outstanding ${doc.summary.closing} ${doc.brand.currency}.`;
  const subject = `${doc.brand.name} account statement`;
  const body = [
    `Hello ${doc.customer.name},`,
    "",
    `Please find your account statement from ${doc.brand.name} attached.`,
    closing,
    `Account ${doc.customer.accountNo}.`,
  ].join("\n");
  const result = await queueEmail(sql, tenantId, dest, subject, body, {
    attachments: [{ filename, content: pdf.toString("base64"), contentType: "application/pdf" }],
  });
  await writeInbox(sql, tenantId, doc.customer.id, subject, body, "statement.emailed");
  return { ...result, to: dest, filename };
}
