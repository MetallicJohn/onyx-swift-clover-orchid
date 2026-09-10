const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

export const MAX_LOGO_BYTES = 400 * 1024;
export const MAX_FAVICON_BYTES = 80 * 1024;

function decodeBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(b64, "base64"));
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function looksLikeImage(buf: Uint8Array, mime: string) {
  if (buf.length < 12) return false;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const ico = buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00;
  const riff = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
  const webp = riff && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  if (mime.includes("png")) return png;
  if (mime.includes("jpeg") || mime.includes("jpg")) return jpeg;
  if (mime.includes("webp")) return webp;
  if (mime.includes("icon")) return ico || png;
  return png || jpeg || webp || ico;
}

function hasUnsafePayload(buf: Uint8Array) {
  const head = new TextDecoder("latin1").decode(buf.subarray(0, Math.min(buf.length, 256))).toLowerCase();
  return head.includes("<svg") || head.includes("<script") || head.includes("javascript:");
}

export function parseDataImage(raw: string, maxBytes: number): string {
  const value = (raw || "").trim();
  if (!value) return "";
  const m = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) throw new Error("Upload a PNG, JPEG, WebP, or ICO image");
  const mime = m[1]!.toLowerCase() === "image/jpg" ? "image/jpeg" : m[1]!.toLowerCase();
  if (mime === "image/svg+xml" || mime.includes("svg")) throw new Error("SVG uploads are not allowed");
  if (!ALLOWED.has(mime)) throw new Error("Upload a PNG, JPEG, WebP, or ICO image");
  const b64 = m[2]!.replace(/\s/g, "");
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > maxBytes) throw new Error(`Image must be under ${Math.round(maxBytes / 1024)} KB`);
  const buf = decodeBase64(b64);
  if (hasUnsafePayload(buf)) throw new Error("That file is not a safe image");
  if (!looksLikeImage(buf, mime)) throw new Error("File content does not match the image type");
  return `data:${mime};base64,${b64}`;
}

export function pngJpegBuffer(dataUrl: string): Buffer | null {
  const m = dataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  try {
    return Buffer.from(m[2]!, "base64");
  } catch {
    return null;
  }
}
