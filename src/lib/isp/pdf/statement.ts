import { formatDay, formatMoney, type StatementDocument } from "../document-format.ts";
import { buildPdf, contentWidth, MARGIN, PdfCtx } from "./engine.ts";

export async function renderStatementPdf(doc: StatementDocument): Promise<Buffer> {
  return buildPdf((ctx) => drawStatement(ctx, doc));
}

function drawStatement(ctx: PdfCtx, st: StatementDocument) {
  const money = (n: number) => formatMoney(n, st.brand.currency);
  ctx.useBrand(st.brand);
  ctx.continuation = `${st.brand.name}  ·  Statement ${st.customer.accountNo}  ·  continued`;
  ctx.drawBrandHeader("STATEMENT", [
    ["Account", st.customer.accountNo],
    ["Period", `${formatDay(st.periodStart, st.brand.timezone)} – ${formatDay(st.periodEnd, st.brand.timezone)}`],
    ["Date", formatDay(st.statementDate, st.brand.timezone)],
  ]);

  ctx.partyBlock("Customer", [
    st.customer.name,
    `Account ${st.customer.accountNo}`,
    st.customer.phone,
    st.customer.email,
    st.customer.address,
  ]);
  ctx.y += 10;

  const s = st.summary;
  const cards: Array<{ label: string; value: string; warn?: boolean; credit?: boolean }> = [
    { label: "Opening balance", value: money(s.opening) },
    { label: "Total invoices", value: money(s.invoices) },
    { label: "Total payments", value: money(s.payments) },
    { label: "Total credits", value: money(s.credits) },
    { label: "Adjustments", value: money(s.adjustments) },
    {
      label: s.closing < 0 ? "Credit balance" : "Closing balance",
      value: money(Math.abs(s.closing)),
      warn: s.closing > 0,
      credit: s.closing < 0,
    },
  ];
  const gap = 8;
  const cardW = (contentWidth() - gap * 2) / 3;
  const cardH = 46;
  ctx.ensure(cardH * 2 + 18);
  cards.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = MARGIN.left + col * (cardW + gap);
    const y = ctx.y + row * (cardH + gap);
    ctx.doc.save();
    ctx.doc.roundedRect(x, y, cardW, cardH, 6).fill(ctx.wash);
    ctx.doc.restore();
    ctx.text(c.label.toUpperCase(), x + 10, y + 8, { size: 6.5, color: ctx.muted, font: "bold" });
    ctx.text(c.value, x + 10, y + 22, {
      size: 11,
      font: "bold",
      color: c.warn ? [148, 40, 40] : c.credit ? [36, 110, 68] : ctx.ink,
    });
  });
  ctx.y += cardH * 2 + gap + 16;

  const ledgerRows =
    st.rows.length > 0
      ? st.rows.map((r) => ({
          date: formatDay(r.date, st.brand.timezone),
          reference: r.reference,
          description: r.description,
          debit: r.debit ? money(r.debit) : "",
          credit: r.credit ? money(r.credit) : "",
          balance: money(r.balance),
        }))
      : [
          {
            date: formatDay(st.statementDate, st.brand.timezone),
            reference: "—",
            description: "No ledger activity in this period",
            debit: "",
            credit: "",
            balance: money(s.opening),
          },
        ];

  ctx.table(
    [
      { key: "date", label: "Date", width: 14 },
      { key: "reference", label: "Reference", width: 18 },
      { key: "description", label: "Description", width: 28 },
      { key: "debit", label: "Debit", width: 13, align: "right" },
      { key: "credit", label: "Credit", width: 13, align: "right" },
      { key: "balance", label: "Balance", width: 14, align: "right" },
    ],
    ledgerRows,
  );

  if (s.closing < 0) {
    ctx.callout("Credit balance", money(Math.abs(s.closing)), "credit");
  } else if (s.closing > 0) {
    ctx.callout("Amount outstanding", money(s.closing), "due");
  } else {
    ctx.callout("Account settled", money(0), "ok");
  }

  if (st.brand.paymentMethods.length && s.closing > 0) {
    ctx.methodCards(st.brand.paymentMethods, st.customer.accountNo);
  }
  ctx.notesBlock([st.brand.notes]);
}
