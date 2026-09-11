declare module "pdfkit/standard-fonts/Helvetica" {
  const font: { name: string };
  export default font;
}

declare module "pdfkit/standard-fonts/HelveticaBold" {
  const font: { name: string };
  export default font;
}

declare module "*pdfkit/js/pdfkit.browser.mjs" {
  import type PDFKitDocument from "pdfkit";
  export function registerStdFonts(...fonts: unknown[]): void;
  export function registerFile(path: string, data?: Uint8Array): void;
  const PDFDocument: typeof PDFKitDocument;
  export default PDFDocument;
  export { PDFDocument };
}
