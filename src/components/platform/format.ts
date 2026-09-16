import { kes } from "@/lib/utils";
import { formatShortDateTime } from "@/lib/isp/display";

export function kesOrDash(n: number | null | undefined) {
  if (n == null) return "—";
  return kes(n);
}

export function nairobiTime(iso: string | null | undefined) {
  return formatShortDateTime(iso);
}