import PDFDocument from "pdfkit";
import { brandInitials, parseBrandColor, type BrandProfile } from "../document-format.ts";

export const A4 = { width: 595.28, height: 841.89 };
export const MARGIN = { top: 44, right: 48, bottom: 54, left: 48 };

type RGB = [number, number, number];

export type Column = {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right";
};

type TextOpts = {
  color?: RGB;
  size?: number;
  font?: "regular" | "bold";
  width?: number;
  align?: "left" | "center" | "right";
  lineBreak?: boolean;
};

type DocCtor = new (opts?: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument;

function createDoc() {
  const Ctor = ((PDFDocument as unknown as { default?: DocCtor }).default ?? PDFDocument) as DocCtor;
  return new Ctor({ size: "A4", margin: 0, bufferPages: true, autoFirstPage: true });
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function luminance(rgb: RGB) {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

export function contentWidth() {
  return A4.width - MARGIN.left - MARGIN.right;
}

export async function buildPdf(draw: (ctx: PdfCtx) => void | Promise<void>): Promise<Buffer> {
  const doc = createDoc();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const ctx = new PdfCtx(doc);
  ctx.paintTopBar();
  await draw(ctx);
  ctx.stampFooters();
  doc.end();
  return done;
}

export class PdfCtx {
  doc: PDFKit.PDFDocument;
  y: number;
  brand: BrandProfile | null = null;
  footerNote = "";
  continuation = "";
  ink: RGB = [22, 28, 36];
  muted: RGB = [96, 108, 120];
  line: RGB = [220, 224, 228];
  accent: RGB = [74, 168, 160];
  paper: RGB = [255, 255, 255];
  wash: RGB = [246, 247, 249];
  zebra: RGB = [250, 251, 252];

  constructor(doc: PDFKit.PDFDocument) {
    this.doc = doc;
    this.y = MARGIN.top;
  }

  useBrand(brand: BrandProfile) {
    this.brand = brand;
    this.accent = parseBrandColor(brand.brandColor).rgb;
    this.wash = mixRgb(this.accent, [255, 255, 255], 0.94);
    this.zebra = mixRgb(this.accent, [255, 255, 255], 0.97);
    this.footerNote = [brand.footer, [brand.phone, brand.email].filter(Boolean).join("  ·  ")].filter(Boolean).join("   ");
  }

  get pageBottom() {
    return A4.height - MARGIN.bottom;
  }

  paintTopBar() {
    this.doc.save();
    this.doc.rect(0, 0, A4.width, 6).fill(this.accent);
    this.doc.restore();
  }

  ensure(space: number) {
    if (this.y + space > this.pageBottom) this.addPage();
  }

  addPage() {
    this.doc.addPage({ size: "A4", margin: 0 });
    this.y = MARGIN.top;
    this.paintTopBar();
    if (this.continuation) {
      this.text(this.continuation, MARGIN.left, this.y, { size: 8, color: this.muted });
      this.y += 16;
      this.rule(this.y);
      this.y += 10;
    }
  }

  text(value: string, x: number, y: number, opts: TextOpts = {}) {
    this.doc.font(opts.font === "bold" ? "Helvetica-Bold" : "Helvetica");
    this.doc.fontSize(opts.size ?? 9);
    this.doc.fillColor(opts.color ?? this.ink);
    this.doc.text(value, x, y, {
      lineBreak: opts.lineBreak ?? false,
      width: opts.width,
      align: opts.align,
    });
  }

  wrap(
    value: string,
    x: number,
    y: number,
    width: number,
    opts: { size?: number; font?: "regular" | "bold"; color?: RGB; align?: "left" | "right" } = {},
  ) {
    this.doc.font(opts.font === "bold" ? "Helvetica-Bold" : "Helvetica");
    this.doc.fontSize(opts.size ?? 9);
    this.doc.fillColor(opts.color ?? this.ink);
    this.doc.text(value, x, y, { width, align: opts.align ?? "left" });
    return this.doc.y;
  }

  rule(y = this.y, color?: RGB) {
    this.doc.save();
    this.doc.strokeColor(color ?? this.line).lineWidth(0.5);
    this.doc.moveTo(MARGIN.left, y).lineTo(A4.width - MARGIN.right, y).stroke();
    this.doc.restore();
  }

  drawBrandHeader(title: string, meta: Array<[string, string]>) {
    const brand = this.brand;
    if (!brand) return;
    const x = MARGIN.left;
    const mark = 38;
    const boxW = 186;
    const boxX = A4.width - MARGIN.right - boxW;
    const nameWidth = boxX - (x + mark + 16) - 12;
    const onAccent: RGB = luminance(this.accent) > 0.62 ? this.ink : [255, 255, 255];

    this.doc.save();
    this.doc.roundedRect(x, this.y, mark, mark, 8).fill(this.accent);
    this.doc.restore();
    this.text(brandInitials(brand.name), x, this.y + 12, {
      width: mark,
      align: "center",
      size: 12,
      font: "bold",
      color: onAccent,
    });

    this.doc.font("Helvetica-Bold").fontSize(13).fillColor(this.ink);
    this.doc.text(brand.name, x + mark + 12, this.y, { width: nameWidth });
    let iy = this.doc.y + 2;
    const details = [
      brand.address,
      [brand.phone, brand.email].filter(Boolean).join("  ·  "),
      brand.website,
      brand.taxPin ? `PIN ${brand.taxPin}` : "",
    ].filter(Boolean);
    for (const line of details) {
      this.doc.font("Helvetica").fontSize(8).fillColor(this.muted);
      this.doc.text(line, x + mark + 12, iy, { width: nameWidth });
      iy = this.doc.y + 1;
    }

    const boxH = Math.max(78, 22 + meta.length * 13 + 8);
    this.doc.save();
    this.doc.roundedRect(boxX, this.y, boxW, boxH, 8).fill(this.wash);
    this.doc.restore();
    this.text(title, boxX + 14, this.y + 10, { size: 11, font: "bold" });
    let my = this.y + 28;
    for (const [k, v] of meta) {
      this.text(k, boxX + 14, my, { size: 7, color: this.muted });
      this.text(v, boxX + 70, my, { size: 8, font: "bold", width: boxW - 84, align: "right" });
      my += 13;
    }
    this.y = Math.max(iy, this.y + boxH) + 14;
  }

  partyBlock(heading: string, lines: string[]) {
    const body = lines.filter(Boolean);
    this.doc.font("Helvetica").fontSize(9);
    const h = 18 + body.reduce((sum, line) => {
      return sum + Math.max(12, this.doc.heightOfString(line, { width: contentWidth() / 2 }));
    }, 0);
    this.ensure(h + 8);
    this.text(heading.toUpperCase(), MARGIN.left, this.y, { size: 7, color: this.muted, font: "bold" });
    this.y += 13;
    for (const line of body) {
      this.wrap(line, MARGIN.left, this.y, contentWidth() * 0.55, { size: 9 });
      this.y = this.doc.y + 1;
    }
  }

  statusChip(label: string, tone: "ok" | "warn" | "danger" | "muted") {
    const fill: Record<typeof tone, RGB> = {
      ok: [226, 242, 232],
      warn: [250, 240, 220],
      danger: [250, 230, 230],
      muted: this.wash,
    };
    const ink: Record<typeof tone, RGB> = {
      ok: [36, 110, 68],
      warn: [132, 88, 20],
      danger: [148, 40, 40],
      muted: this.muted,
    };
    this.doc.font("Helvetica-Bold").fontSize(8);
    const w = Math.min(140, Math.max(58, this.doc.widthOfString(label) + 18));
    const x = A4.width - MARGIN.right - w;
    this.doc.save();
    this.doc.roundedRect(x, this.y, w, 16, 8).fill(fill[tone]);
    this.doc.restore();
    this.text(label, x, this.y + 4, { width: w, align: "center", size: 8, font: "bold", color: ink[tone] });
  }

  table(columns: Column[], rows: Array<Record<string, string>>) {
    const startX = MARGIN.left;
    const usable = contentWidth();
    const total = columns.reduce((s, c) => s + c.width, 0) || 1;
    const cols = columns.map((c) => ({ ...c, width: (c.width / total) * usable }));
    const headerH = 22;
    const headerFill = luminance(this.accent) > 0.62 ? this.ink : this.accent;
    const headerInk: RGB = luminance(headerFill) > 0.62 ? this.ink : [255, 255, 255];
    const drawHeader = () => {
      this.ensure(headerH + 10);
      this.doc.save();
      this.doc.roundedRect(startX, this.y, usable, headerH, 4).fill(headerFill);
      this.doc.restore();
      let x = startX;
      for (const col of cols) {
        this.text(col.label.toUpperCase(), x + 6, this.y + 7, {
          width: col.width - 12,
          align: col.align ?? "left",
          size: 7,
          font: "bold",
          color: headerInk,
        });
        x += col.width;
      }
      this.y += headerH;
    };
    drawHeader();
    rows.forEach((row, idx) => {
      const heights = cols.map((col) => {
        this.doc.font("Helvetica").fontSize(8);
        return this.doc.heightOfString(row[col.key] || " ", { width: col.width - 12 });
      });
      const h = Math.max(18, ...heights) + 8;
      if (this.y + h > this.pageBottom) {
        this.addPage();
        drawHeader();
      }
      if (idx % 2 === 1) {
        this.doc.save();
        this.doc.rect(startX, this.y, usable, h).fill(this.zebra);
        this.doc.restore();
      }
      let x = startX;
      for (const col of cols) {
        this.doc.font("Helvetica").fontSize(8).fillColor(this.ink);
        this.doc.text(row[col.key] || "", x + 6, this.y + 5, {
          width: col.width - 12,
          align: col.align ?? "left",
        });
        x += col.width;
      }
      this.y += h;
    });
    this.rule(this.y);
    this.y += 12;
  }

  totalsBox(rows: Array<{ label: string; value: string; strong?: boolean; warn?: boolean; credit?: boolean }>) {
    const boxW = 248;
    const boxX = A4.width - MARGIN.right - boxW;
    const h = rows.reduce((s, r) => s + (r.strong ? 22 : 16), 16);
    this.ensure(h + 8);
    this.doc.save();
    this.doc.roundedRect(boxX, this.y, boxW, h, 8).fill(this.wash);
    this.doc.restore();
    let y = this.y + 10;
    for (const row of rows) {
      const color: RGB = row.warn ? [148, 40, 40] : row.credit ? [36, 110, 68] : row.strong ? this.ink : this.muted;
      this.text(row.label, boxX + 14, y, {
        size: row.strong ? 10 : 8,
        font: row.strong ? "bold" : "regular",
        color,
      });
      this.text(row.value, boxX + 14, y, {
        width: boxW - 28,
        align: "right",
        size: row.strong ? 11 : 9,
        font: "bold",
        color,
      });
      y += row.strong ? 22 : 16;
    }
    this.y += h + 12;
  }

  callout(label: string, value: string, tone: "due" | "credit" | "ok") {
    this.ensure(48);
    const fill: RGB = tone === "due" ? [250, 232, 232] : tone === "credit" ? [226, 242, 232] : this.wash;
    const ink: RGB = tone === "due" ? [148, 40, 40] : tone === "credit" ? [36, 110, 68] : this.ink;
    this.doc.save();
    this.doc.roundedRect(MARGIN.left, this.y, contentWidth(), 40, 8).fill(fill);
    this.doc.restore();
    this.text(label.toUpperCase(), MARGIN.left + 16, this.y + 8, { size: 7, font: "bold", color: ink });
    this.text(value, MARGIN.left + 16, this.y + 20, { size: 14, font: "bold", color: ink });
    this.y += 52;
  }

  methodCards(methods: Array<{ label: string; detail: string }>, reference: string) {
    if (!methods.length) return;
    this.ensure(36);
    this.text("HOW TO PAY", MARGIN.left, this.y, { size: 7, font: "bold", color: this.muted });
    this.y += 14;
    const gap = 10;
    const cardW = (contentWidth() - gap) / 2;
    methods.forEach((m, i) => {
      if (i % 2 === 0) this.ensure(58);
      const col = i % 2;
      const x = MARGIN.left + col * (cardW + gap);
      const y = this.y;
      this.doc.save();
      this.doc.roundedRect(x, y, cardW, 50, 7).fill(this.wash);
      this.doc.restore();
      this.text(m.label, x + 12, y + 10, { size: 9, font: "bold" });
      this.doc.font("Helvetica").fontSize(8).fillColor(this.muted);
      this.doc.text(`${m.detail}\nAccount ref ${reference}`, x + 12, y + 24, { width: cardW - 24 });
      if (col === 1 || i === methods.length - 1) this.y += 60;
    });
  }

  notesBlock(notes: string[]) {
    const unique = notes.filter((n, i, a) => n && a.indexOf(n) === i);
    if (!unique.length) return;
    this.ensure(28);
    this.text("NOTES", MARGIN.left, this.y, { size: 7, font: "bold", color: this.muted });
    this.y += 12;
    for (const n of unique) {
      this.ensure(20);
      this.wrap(n, MARGIN.left, this.y, contentWidth(), { size: 8, color: this.muted });
      this.y = this.doc.y + 4;
    }
  }

  stampFooters() {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      this.doc.switchToPage(range.start + i);
      this.doc.save();
      this.doc.rect(0, 0, A4.width, 6).fill(this.accent);
      this.doc.restore();
      const y = A4.height - 40;
      this.doc.save();
      this.doc.strokeColor(this.line).lineWidth(0.5);
      this.doc.moveTo(MARGIN.left, y).lineTo(A4.width - MARGIN.right, y).stroke();
      this.doc.restore();
      this.doc.font("Helvetica").fontSize(7).fillColor(this.muted);
      this.doc.text(this.footerNote, MARGIN.left, y + 8, { width: contentWidth() - 90, lineBreak: false });
      this.doc.text(`Page ${i + 1} of ${range.count}`, MARGIN.left, y + 8, {
        width: contentWidth(),
        align: "right",
        lineBreak: false,
      });
    }
  }
}
