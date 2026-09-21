/** Copy text to the clipboard. Falls back to a hidden textarea when the Clipboard API is blocked. */

export const AUTOCOPY_IDLE = "Autocopy";
export const COPY_SCRIPT_IDLE = "Copy Script";
export const AUTOCOPY_DONE = "Copied ✓";
export const AUTOCOPY_FAIL = "Unable to copy automatically. Please copy the script manually.";

export function autocopyLabel(copied: boolean) {
  return copied ? AUTOCOPY_DONE : AUTOCOPY_IDLE;
}

export function copyScriptLabel(copied: boolean) {
  return copied ? AUTOCOPY_DONE : COPY_SCRIPT_IDLE;
}

export async function copyText(text: string) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/** Client-side .rsc download. No public URL — body is already in memory from an authenticated fetch. */
export function downloadTextFile(filename: string, body: string) {
  const value = String(body || "");
  const name = String(filename || "ispsolutions.rsc").replace(/[^\w.\-]+/g, "_");
  if (!value || typeof document === "undefined") return false;
  const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
