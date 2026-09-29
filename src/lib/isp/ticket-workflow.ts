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

export function technicianMoves(from: string): TicketStatus[] {
  return TICKET_STATUSES.filter((to) => to !== from && canTechnicianSet(from, to));
}

/** Field replies on WhatsApp. Full message only, so a customer sentence is not a status change. */
export function parseTechnicianCommand(text: string): TicketStatus | null {
  const q = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (/^(on site|onsite|arrived|i am here|i'm here|at site)$/.test(q)) return "on_site";
  if (/^(resolved|resolve|done|fixed|complete|completed)$/.test(q)) return "resolved";
  if (/^(travelling|traveling|on the way|en route|enroute|otw)$/.test(q)) return "travelling";
  if (/^(accepted|accept|i accept)$/.test(q)) return "accepted";
  if (/^(waiting|on hold)$/.test(q)) return "waiting";
  return null;
}
