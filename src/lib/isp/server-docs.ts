import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { loadInvoiceDocument, loadStatementDocument } from "./documents";
import { emailInvoice, emailStatement, makeInvoicePdf, makeStatementPdf } from "./pdf/service";
import { portalContext } from "./portal";
import { assertPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

function pdfPayload(filename: string, pdf: Buffer) {
  return { filename, mime: "application/pdf", base64: pdf.toString("base64") };
}

export const getDocumentBranding = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const [ten] = await sql<{
      name: string;
      address: string;
      website: string;
      tax_pin: string;
      invoice_footer: string;
      invoice_notes: string;
      brand_color: string;
      bank_name: string;
      bank_account: string;
      bank_branch: string;
      support_email: string;
      support_phone: string;
    }>`select name, coalesce(address,'') as address, coalesce(website,'') as website,
              coalesce(tax_pin,'') as tax_pin, coalesce(invoice_footer,'') as invoice_footer,
              coalesce(invoice_notes,'') as invoice_notes, coalesce(brand_color,'') as brand_color,
              coalesce(bank_name,'') as bank_name, coalesce(bank_account,'') as bank_account,
              coalesce(bank_branch,'') as bank_branch, support_email, support_phone
       from tenants where id = ${tenantId}`;
    return (
      ten ?? {
        name: "",
        address: "",
        website: "",
        tax_pin: "",
        invoice_footer: "",
        invoice_notes: "",
        brand_color: "",
        bank_name: "",
        bank_account: "",
        bank_branch: "",
        support_email: "",
        support_phone: "",
      }
    );
  });

export const saveDocumentBranding = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      address: string;
      website: string;
      tax_pin: string;
      invoice_footer: string;
      invoice_notes: string;
      brand_color: string;
      bank_name: string;
      bank_account: string;
      bank_branch: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const color = data.brand_color.trim();
    if (color && !/^#?[0-9a-fA-F]{6}$/.test(color)) throw new Error("Brand colour must be a 6-digit hex value");
    const hex = color ? (color.startsWith("#") ? color : `#${color}`) : "";
    await sql`update tenants set
      address = ${data.address.trim()},
      website = ${data.website.trim()},
      tax_pin = ${data.tax_pin.trim()},
      invoice_footer = ${data.invoice_footer.trim()},
      invoice_notes = ${data.invoice_notes.trim()},
      brand_color = ${hex},
      bank_name = ${data.bank_name.trim()},
      bank_account = ${data.bank_account.trim()},
      bank_branch = ${data.bank_branch.trim()}
      where id = ${tenantId}`;
    return { ok: true };
  });

export const getInvoiceDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "invoices.read");
    return loadInvoiceDocument(sql, tenantId, data.id);
  });

export const getInvoicePdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "invoices.read");
    const { filename, pdf } = await makeInvoicePdf(sql, tenantId, data.id);
    return pdfPayload(filename, pdf);
  });

export const emailInvoicePdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; to?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "invoices.read");
    return emailInvoice(sql, tenantId, data.id, data.to);
  });

export const getStatementDocument = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "invoices.read");
    return loadStatementDocument(sql, tenantId, data.customer_id);
  });

export const getStatementPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "invoices.read");
    const { filename, pdf } = await makeStatementPdf(sql, tenantId, data.customer_id);
    return pdfPayload(filename, pdf);
  });

export const emailStatementPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; to?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "invoices.read");
    return emailStatement(sql, tenantId, data.customer_id, data.to);
  });

export const portalInvoicePdf = createServerFn({ method: "POST" })
  .validator((d: { token: string; id: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    const { doc, filename, pdf } = await makeInvoicePdf(sql, ctx.tenantId, data.id);
    if (doc.customer.id !== ctx.customer.id) throw new Error("Invoice not found");
    return pdfPayload(filename, pdf);
  });

export const portalStatementPdf = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ctx = await portalContext(sql, data.token);
    const { filename, pdf } = await makeStatementPdf(sql, ctx.tenantId, ctx.customer.id);
    return pdfPayload(filename, pdf);
  });
