import { formatDay, formatMoney, invoiceStatusTone, type InvoiceDocument } from "../document-format.ts";
import { buildPdf, contentWidth, MARGIN, PdfCtx } from "./engine.ts";

export { invoiceStatusTone };

export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Buffer> {
  return buildPdf((ctx) => drawInvoice(ctx, doc));
}

function drawInvoice(ctx: PdfCtx, inv: InvoiceDocument) {
  const money = (n: number) => formatMoney(n, inv.brand.currency);
  ctx.useBrand(inv.brand);
  ctx.continuation = `${inv.brand.name}  ·  Invoice ${inv.invoice.number}  ·  continued`;
  ctx.drawBrandHeader("INVOICE", [
    ["Number", inv.invoice.number],
    ["Issued", formatDay(inv.invoice.issuedAt, inv.brand.timezone)],
    ["Due", formatDay(inv.invoice.dueDate, inv.brand.timezone)],
    ["Account", inv.customer.accountNo],
  ]);
  ctx.statusChip(inv.invoice.statusLabel, invoiceStatusTone(inv.invoice.statusLabel));
  ctx.y += 24;

  ctx.partyBlock("Bill to", [
    inv.customer.name,
    `Account ${inv.customer.accountNo}`,
    inv.customer.phone,
    inv.customer.email,
    inv.customer.address,
  ]);
  ctx.y += 12;

  ctx.table(
    [
      { key: "description", label: "Description", width: 28 },
      { key: "packageName", label: "Service", width: 16 },
      { key: "period", label: "Period", width: 18 },
      { key: "quantity", label: "Qty", width: 6, align: "right" },
      { key: "unit", label: "Unit price", width: 10, align: "right" },
      { key: "discount", label: "Discount", width: 7, align: "right" },
      { key: "tax", label: "Tax", width: 7, align: "right" },
      { key: "total", label: "Total", width: 8, align: "right" },
    ],
    inv.lines.map((l) => ({
      description: l.description,
      packageName: l.packageName,
      period: l.period,
      quantity: String(l.quantity),
      unit: money(l.unit),
      discount: l.discount ? money(l.discount) : "—",
      tax: l.tax ? money(l.tax) : "—",
      total: money(l.total),
    })),
  );

  const t = inv.totals;
  const rows: Array<{ label: string; value: string; strong?: boolean; warn?: boolean; credit?: boolean }> = [
    { label: "Subtotal", value: money(t.subtotal) },
  ];
  if (t.discount) rows.push({ label: "Discount", value: `− ${money(t.discount)}` });
  if (t.tax) rows.push({ label: `VAT ${t.taxRate}%`, value: money(t.tax) });
  rows.push({
    label: t.previousBalance < 0 ? "Previous credit" : "Previous balance",
    value: money(Math.abs(t.previousBalance)),
  });
  if (t.payments) rows.push({ label: "Payments / credits", value: `− ${money(t.payments)}` });
  rows.push({ label: "Amount due", value: money(t.amountDue) });
  if (t.creditBalance > 0) {
    rows.push({ label: "Credit balance", value: money(t.creditBalance), strong: true, credit: true });
  } else {
    rows.push({
      label: "Total payable",
      value: money(t.totalPayable),
      strong: true,
      warn: t.totalPayable > 0,
    });
  }
  ctx.totalsBox(rows);

  if (t.creditBalance > 0) {
    ctx.callout("Credit balance", money(t.creditBalance), "credit");
  } else if (t.totalPayable > 0) {
    ctx.callout("Total payable", money(t.totalPayable), "due");
  }

  if (inv.payments.length) {
    ctx.ensure(36);
    ctx.text("RECEIPTS ON THIS INVOICE", MARGIN.left, ctx.y, { size: 7, font: "bold", color: ctx.muted });
    ctx.y += 14;
    for (const p of inv.payments) {
      ctx.ensure(14);
      ctx.text(
        `${p.provider}  ${p.reference}  ${formatDay(p.paidAt, inv.brand.timezone)}`,
        MARGIN.left,
        ctx.y,
        { size: 8, color: ctx.muted },
      );
      ctx.text(money(p.amount), MARGIN.left, ctx.y, {
        width: contentWidth(),
        align: "right",
        size: 8,
        font: "bold",
      });
      ctx.y += 13;
    }
    ctx.y += 8;
  }

  if (t.totalPayable > 0) {
    ctx.methodCards(inv.brand.paymentMethods, inv.customer.accountNo);
  }
  ctx.notesBlock([inv.invoice.notes, inv.brand.notes]);
}
