/** Copy text to the clipboard. Falls back to a hidden textarea when the Clipboard API is blocked. */

export const AUTOCOPY_IDLE = "Autocopy";
export const AUTOCOPY_DONE = "Copied ✓";
export const AUTOCOPY_FAIL = "Unable to copy automatically. Please copy the script manually.";

export function autocopyLabel(copied: boolean) {
  return copied ? AUTOCOPY_DONE : AUTOCOPY_IDLE;
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