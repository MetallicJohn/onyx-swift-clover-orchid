import { TICKET_STATUSES } from "./ticket-workflow.ts";

const TICKET_PAGE_SIZES = [20, 50, 100] as const;
const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TICKET_STATUS_FILTERS = new Set<string>(["all", "open", "closed", ...TICKET_STATUSES]);

export type TicketListQuery = {
  q?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignedTo?: string;
  sla?: "past" | "all";
  page?: number;
  pageSize?: number;
};

export function normalizeTicketListQuery(raw?: Partial<TicketListQuery> | null): {
  q: string;
  status: string;
  priority: string;
  category: string;
  assignedTo: string;
  sla: "past" | "all";
  page: number;
  pageSize: number;
} {
  const status = String(raw?.status || "open");
  const priority = String(raw?.priority || "all");
  const category = String(raw?.category || "all").trim().slice(0, 40) || "all";
  const assignedTo = String(raw?.assignedTo || "all").trim().slice(0, 80) || "all";
  const sla = raw?.sla === "past" ? "past" : "all";
  const pageSizeRaw = Number(raw?.pageSize);
  const pageSize = (TICKET_PAGE_SIZES as readonly number[]).includes(pageSizeRaw) ? pageSizeRaw : 20;
  const page = Math.max(1, Math.trunc(Number(raw?.page) || 1));
  return {
    q: String(raw?.q || "").trim().slice(0, 80),
    status: TICKET_STATUS_FILTERS.has(status) ? status : "open",
    priority: priority === "all" || priority === "elevated" || (TICKET_PRIORITIES as readonly string[]).includes(priority) ? priority : "all",
    category,
    assignedTo,
    sla,
    page,
    pageSize,
  };
}

/** Filter changes go back to page 1. Page changes keep the current filters. */
export function nextTicketSearch(current: Partial<TicketListQuery>, patch: Partial<TicketListQuery>, keepPage = false) {
  return normalizeTicketListQuery({
    ...current,
    ...patch,
    page: keepPage ? (patch.page ?? current.page ?? 1) : 1,
  });
}

function chipLabel(value: string) {
  return value.replaceAll("_", " ");
}

/** Active ticket filters, excluding the default open queue. */
export function ticketListChips(
  query: ReturnType<typeof normalizeTicketListQuery>,
  assignedLabel = "",
): { id: string; label: string }[] {
  const chips: { id: string; label: string }[] = [];
  if (query.status !== "open") chips.push({ id: "status", label: `Status: ${chipLabel(query.status)}` });
  if (query.priority !== "all") {
    chips.push({
      id: "priority",
      label: query.priority === "elevated" ? "Priority: urgent or high" : `Priority: ${chipLabel(query.priority)}`,
    });
  }
  if (query.sla === "past") chips.push({ id: "sla", label: "Past SLA" });
  if (query.category !== "all") chips.push({ id: "category", label: `Category: ${chipLabel(query.category)}` });
  if (query.assignedTo !== "all") {
    const who = query.assignedTo === "unassigned" ? "Unassigned" : assignedLabel || "Staff";
    chips.push({ id: "assigned", label: `Assigned: ${who}` });
  }
  if (query.q.length >= 2) chips.push({ id: "q", label: `Search: ${query.q}` });
  return chips;
}
