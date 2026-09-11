/**
 * PDFKit 0.20's Node build lazy-requires `#standard-fonts/Helvetica`. Nitro's
 * Vercel bundle inlines pdfkit into `_libs/pdfkit+png-js.mjs`, so that private
 * import map no longer resolves (Cannot find module '#standard-fonts/Helvetica').
 *
 * The browser ESM build plus registerStdFonts() is the supported bundler path
 * and works in Node, Vercel, and the VPS image.
 */
import PDFDocument, { registerStdFonts } from "../../../../node_modules/pdfkit/js/pdfkit.browser.mjs";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";

registerStdFonts(Helvetica, HelveticaBold);

export default PDFDocument as unknown as typeof import("pdfkit");
