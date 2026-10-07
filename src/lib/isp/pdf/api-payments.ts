import { formatMoney, type BrandProfile } from "../document-format.ts";
import { buildPdf, contentWidth, MARGIN, PdfCtx } from "./engine.ts";

export type ApiPaymentsPdfReport = {
  brand: BrandProfile;
  period: string;
  filters: string;
  generated: string;
  received: number;
  processed: number;
  unmatched: number;
  failed: number;
  nReceived: number;
  nProcessed: number;
  nUnmatched: number;
  nFailed: number;
  methods: Array<{ label: string; amount: number; n: number }>;
  rows: Array<{
    when: string;
    transaction: string;
    method: string;
    account: string;
    customer: string;
    amount: string;
    status: string;
  }>;
  total: number;
  truncated: boolean;
};

export async function renderApiPaymentsPdf(report: ApiPaymentsPdfReport): Promise<Buffer> {
  return buildPdf((ctx) => drawApiPayments(ctx, report));
}

function drawApiPayments(ctx: PdfCtx, report: ApiPaymentsPdfReport) {
  const money = (n: number) => formatMoney(n, report.brand.currency);
  ctx.useBrand(report.brand);
  ctx.continuation = `${report.brand.name}  ·  API payments  ·  continued`;
  ctx.drawBrandHeader("API PAYMENTS", [
    ["Period", report.period],
    ["Generated", report.generated],
  ]);
  ctx.wrap(report.filters, MARGIN.left, ctx.y, contentWidth(), { size: 8, color: ctx.muted });
  ctx.y = ctx.doc.y + 12;

  const cards = [
    { label: "Received", value: money(report.received), hint: `${report.nReceived} payments` },
    { label: "Processed", value: money(report.processed), hint: `${report.nProcessed} posted` },
    { label: "Unmatched", value: money(report.unmatched), hint: `${report.nUnmatched} waiting`, warn: report.nUnmatched > 0 },
    { label: "Failed", value: money(report.failed), hint: `${report.nFailed} to retry`, warn: report.nFailed > 0 },
  ];
  const gap = 8;
  const cardW = (contentWidth() - gap * 3) / 4;
  const cardH = 48;
  ctx.ensure(cardH + 8);
  cards.forEach((card, i) => {
    const x = MARGIN.left + i * (cardW + gap);
    ctx.doc.save();
    ctx.doc.roundedRect(x, ctx.y, cardW, cardH, 6).fill(ctx.wash);
    ctx.doc.restore();
    ctx.text(card.label.toUpperCase(), x + 8, ctx.y + 7, { size: 6.5, color: ctx.muted, font: "bold" });
    ctx.text(card.value, x + 8, ctx.y + 18, {
      size: 9,
      font: "bold",
      color: card.warn ? [148, 40, 40] : ctx.ink,
      width: cardW - 16,
    });
    ctx.text(card.hint, x + 8, ctx.y + 32, { size: 7, color: ctx.muted, width: cardW - 16 });
  });
  ctx.y += cardH + 14;

  if (report.methods.length) {
    ctx.table(
      [
        { key: "method", label: "Payment method", width: 50 },
        { key: "count", label: "Count", width: 20, align: "right" },
        { key: "amount", label: "Amount", width: 30, align: "right" },
      ],
      report.methods.map((method) => ({
        method: method.label,
        count: String(method.n),
        amount: money(method.amount),
      })),
    );
  }

  ctx.table(
    [
      { key: "when", label: "When", width: 16 },
      { key: "transaction", label: "Transaction", width: 16 },
      { key: "method", label: "Method", width: 14 },
      { key: "account", label: "Account", width: 16 },
      { key: "customer", label: "Customer", width: 16 },
      { key: "amount", label: "Amount", width: 12, align: "right" },
      { key: "status", label: "Status", width: 10 },
    ],
    report.rows.length
      ? report.rows
      : [
          {
            when: "—",
            transaction: "—",
            method: "—",
            account: "—",
            customer: "No API payments in this filter",
            amount: money(0),
            status: "—",
          },
        ],
  );

  const notes = ["Received is the provider total. Processed is what the payment pipeline posted."];
  if (report.truncated) {
    notes.push(`This PDF includes the first ${report.rows.length} of ${report.total} rows. Narrow the filter, or use Export CSV for up to 5,000 rows.`);
  }
  ctx.notesBlock(notes);
}
