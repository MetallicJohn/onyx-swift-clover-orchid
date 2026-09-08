export const TICKET_STATUSES = [
  "new",
  "assigned",
  "accepted",
  "travelling",
  "on_site",
  "waiting",
  "resolved",
  "closed",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

const ORDER = TICKET_STATUSES as readonly string[];

export function slaHours(priority: string) {
  if (priority === "urgent") return 4;
  if (priority === "high") return 8;
  if (priority === "low") return 72;
  return 24;
}

export function dueAt(priority: string, now = new Date()) {
  return new Date(now.getTime() + slaHours(priority) * 3600_000);
}

export function canTechnicianSet(from: string, to: string) {
  const i = ORDER.indexOf(from);
  const j = ORDER.indexOf(to);
  if (i < 0 || j < 0) return false;
  return j >= i && j - i <= 2;
}
