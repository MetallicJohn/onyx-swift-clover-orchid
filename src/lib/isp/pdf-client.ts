export type PdfFile = {
  filename: string;
  base64: string;
};

export function pdfBlob(file: PdfFile) {
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

export function downloadPdf(file: PdfFile) {
  const url = URL.createObjectURL(pdfBlob(file));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.rel = "noopener";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function viewPdf(file: PdfFile) {
  const url = URL.createObjectURL(pdfBlob(file));
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function printPdf(file: PdfFile) {
  const url = URL.createObjectURL(pdfBlob(file));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.src = url;
  document.body.appendChild(frame);
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
}
