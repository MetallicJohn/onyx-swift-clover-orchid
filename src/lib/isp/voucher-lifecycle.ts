export type VoucherStatus = "unused" | "active" | "expired" | "cancelled";

export function activateVoucherClock(hours: number, now = new Date()) {
  const expires = new Date(now.getTime() + Math.max(1, hours) * 3600_000);
  return { status: "active" as const, used_at: now, expires_at: expires };
}

export function nextVoucherStatus(status: VoucherStatus, expiresAt: Date | null, now = new Date()): VoucherStatus {
  if (status === "cancelled") return "cancelled";
  if (status === "unused") return "unused";
  if (status === "active" && expiresAt && expiresAt.getTime() <= now.getTime()) return "expired";
  return status;
}

export function canActivate(status: VoucherStatus) {
  return status === "unused";
}

export function canRevoke(status: VoucherStatus) {
  return status === "unused" || status === "active";
}
