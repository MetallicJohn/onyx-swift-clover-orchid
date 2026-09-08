export function normalizePhone(raw: string) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 9 && digits.startsWith("7")) return `254${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("254") && digits.length >= 12) return digits.slice(0, 12);
  return digits;
}
