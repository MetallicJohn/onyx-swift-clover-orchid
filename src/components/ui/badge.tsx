import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  muted: "bg-elevated text-muted",
  accent: "bg-accent/15 text-accent",
};

export function Badge({
  tone = "muted",
  className,
  children,
}: {
  tone?: keyof typeof tones | string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        tones[tone] ?? tones.muted,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Map a domain status string onto Badge tone classes. */
export function statusTone(status: string) {
  const s = status.toLowerCase();
  if (["active", "paid", "connected", "resolved", "closed", "confirmed", "online", "sent", "healthy"].includes(s)) return "ok";
  if (
    [
      "grace",
      "due",
      "issued",
      "pending",
      "assigned",
      "travelling",
      "degraded",
      "on_site",
      "partial",
      "trial",
      "past_due",
      "warning",
      "queued",
      "sending",
      "skipped",
    ].includes(s)
  )
    return "warn";
  if (["suspended", "overdue", "offline", "urgent", "terminated", "error", "expired", "cancelled", "critical", "failed"].includes(s))
    return "danger";
  return "muted";
}
