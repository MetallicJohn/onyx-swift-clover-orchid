import { kes } from "@/lib/utils";

export function kesOrDash(n: number | null | undefined) {
  if (n == null) return "—";
  return kes(n);
}

export function nairobiTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 16).replace("T", " ");
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  }).format(new Date(t));
}
