import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { TicketLive } from "@/components/isp/ticket-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { accessMethodLabel, formatRelativeTime } from "@/lib/isp/display";
import { searchOnboardCustomersFn } from "@/lib/isp/server-onboard";
import { assignOpenTicket, commentOpenTicket, listTicketStaff } from "@/lib/isp/server-more";
import { createTicket, listTickets, setTicketStatus, ticketCustomerServices } from "@/lib/isp/server";
import { hasPermission } from "@/lib/isp/rbac";
import { nextTicketSearch, normalizeTicketListQuery, type TicketListQuery } from "@/lib/isp/ticket-list-format";
import type { TicketCustomerService, TicketListItem } from "@/lib/isp/tickets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/tickets")({
  validateSearch: (search: Record<string, unknown>): TicketSearch => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
    priority: typeof search.priority === "string" ? search.priority : undefined,
    category: typeof search.category === "string" ? search.category : undefined,
    assigned: typeof search.assigned === "string" ? search.assigned : undefined,
    page: Number(search.page) > 1 ? Math.trunc(Number(search.page)) : undefined,
    pageSize: Number(search.pageSize) === 50 || Number(search.pageSize) === 100 ? Number(search.pageSize) : undefined,
  }),
  component: TicketsPage,
});

type TicketSearch = {
  q?: string;
  status?: string;
  priority?: string;
  category?: string;
  assigned?: string;
  page?: number;
  pageSize?: number;
};

type StaffMember = { user_id: string; role: string; name: string };
type CustomerHit = { id: string; name: string; phone: string; account_number: string };
type ListData = Awaited<ReturnType<typeof listTickets>>;

const STATUSES = ["new", "assigned", "accepted", "travelling", "on_site", "waiting", "resolved", "closed"] as const;
const CREATE_CATEGORIES = [
  { id: "performance", label: "Performance" },
  { id: "billing", label: "Billing" },
  { id: "network", label: "Network" },
  { id: "hotspot", label: "Hotspot" },
  { id: "install", label: "Installation" },
] as const;
const FILTER_CATEGORIES = [...CREATE_CATEGORIES, { id: "support", label: "Support" }, { id: "field", label: "Field" }] as const;
const PRIORITIES = [
  { id: "low", label: "Low" },
  { id: "normal", label: "Normal" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
] as const;
const STATUS_OPTIONS = [
  { id: "open", label: "Open" },
  { id: "all", label: "All statuses" },
  ...STATUSES.map((id) => ({ id, label: labelize(id) })),
];

function labelize(value: string) {
  return value.replaceAll("_", " ");
}

function ticketStatusTone(status: string) {
  if (status === "resolved") return "ok";
  if (status === "closed") return "muted";
  if (status === "waiting" || status === "on_site" || status === "travelling") return "warn";
  if (status === "new" || status === "assigned" || status === "accepted") return "accent";
  return "muted";
}

function ticketPriorityTone(priority: string) {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warn";
  if (priority === "normal") return "accent";
  return "muted";
}

function toSearch(q: ReturnType<typeof normalizeTicketListQuery>): TicketSearch {
  return {
    q: q.q.length >= 2 ? q.q : undefined,
    status: q.status === "open" ? undefined : q.status,
    priority: q.priority === "all" ? undefined : q.priority,
    category: q.category === "all" ? undefined : q.category,
    assigned: q.assignedTo === "all" ? undefined : q.assignedTo,
    page: q.page > 1 ? q.page : undefined,
    pageSize: q.pageSize === 20 ? undefined : q.pageSize,
  };
}

function queryFromSearch(search: TicketSearch): TicketListQuery {
  return {
    q: search.q,
    status: search.status,
    priority: search.priority,
    category: search.category,
    assignedTo: search.assigned,
    page: search.page,
    pageSize: search.pageSize,
  };
}

function pageWindow(page: number, pages: number) {
  const width = 5;
  let start = Math.max(1, page - 2);
  const end = Math.min(pages, start + width - 1);
  start = Math.max(1, end - width + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function serviceChoice(service: TicketCustomerService) {
  const name = service.package_name || service.label;
  const speed = service.download_mbps > 0 ? ` — ${service.download_mbps} Mbps` : "";
  const method = accessMethodLabel(service.access_method);
  const extra = service.static_ip || service.username;
  return `${name}${speed} · ${method}${extra ? ` · ${extra}` : ""}`;
}

function messageOf(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function TicketActions({
  ticket,
  staff,
  updating,
  comment,
  onAssign,
  onClose,
  onToggleUpdate,
  onStatus,
  onCommentChange,
  onSaveNote,
  canAssign,
  canUpdate,
}: {
  ticket: TicketListItem;
  staff: StaffMember[];
  updating: boolean;
  comment: string;
  onAssign: (userId: string) => void;
  onClose: () => void;
  onToggleUpdate: () => void;
  onStatus: (status: string) => void;
  onCommentChange: (value: string) => void;
  onSaveNote: (visibleToCustomer: boolean) => void;
  canAssign: boolean;
  canUpdate: boolean;
}) {
  const done = ticket.status === "resolved" || ticket.status === "closed";
  return (
    <div className="grid gap-2">
      {canAssign || canUpdate ? (
        <div className="flex flex-wrap items-center gap-2">
          {canAssign ? (
            <Select
              className="h-9 min-w-0 flex-1"
              aria-label="Assign ticket"
              value=""
              disabled={done}
              onChange={(e) => {
                if (e.target.value) onAssign(e.target.value);
              }}
            >
              <option value="">Assign</option>
              {staff.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : null}
          {canUpdate ? (
            <Button type="button" size="sm" variant="secondary" className="shrink-0" disabled={done} onClick={onToggleUpdate}>
              Update
            </Button>
          ) : null}
          {canUpdate ? (
            <Button type="button" size="sm" variant={done ? "ghost" : "secondary"} className="shrink-0" disabled={done} onClick={onClose}>
              Close
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">You can view this ticket. Updating it needs ticket access.</p>
      )}
      {canUpdate && updating && !done ? (
        <div className="grid gap-2">
          <Select className="h-9" aria-label="Update status" value={ticket.status} onChange={(e) => onStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelize(s)}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-9 min-w-40 flex-1" placeholder="Add a note" value={comment} onChange={(e) => onCommentChange(e.target.value)} />
            <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => onSaveNote(false)}>
              Internal note
            </Button>
            <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => onSaveNote(true)}>
              Reply to customer
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TicketSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading tickets">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-surface" />
      ))}
    </div>
  );
}

function TicketsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = normalizeTicketListQuery(queryFromSearch(search));
  const [q, setQ] = useState(search.q || "");
  const [data, setData] = useState<ListData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState<TicketListItem | null>(null);
  const [comment, setComment] = useState("");
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [customerQ, setCustomerQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [picked, setPicked] = useState<CustomerHit | null>(null);
  const [services, setServices] = useState<TicketCustomerService[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("performance");
  const [priority, setPriority] = useState("normal");
  const [serviceId, setServiceId] = useState("");
  const [assigned, setAssigned] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const searchGen = useRef(0);

  const role = data?.workspace.role || "";
  const canCreate = hasPermission(role, "tickets.manage");
  const canAssign = canCreate;
  const canUpdate = canCreate || hasPermission(role, "jobs.update");

  function staffName(userId?: string) {
    if (!userId) return "Unassigned";
    return staff.find((s) => s.user_id === userId)?.name || "Staff";
  }

  function write(patch: Partial<TicketListQuery>, keepPage = false) {
    const next = nextTicketSearch(query, patch, keepPage);
    void navigate({ search: toSearch(next), replace: true });
  }

  useEffect(() => {
    setQ(search.q || "");
  }, [search.q]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const typed = q.trim();
      if (typed.length === 1) return;
      const nextQ = typed.length >= 2 ? typed : "";
      if (nextQ === (search.q || "")) return;
      const next = nextTicketSearch(queryFromSearch(search), { q: nextQ });
      void navigate({ search: toSearch(next), replace: true });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [q, search, navigate]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([
      listTickets({
        data: {
          q: query.q,
          status: query.status,
          priority: query.priority,
          category: query.category,
          assignedTo: query.assignedTo,
          page: query.page,
          pageSize: query.pageSize,
        },
      }),
      listTicketStaff(),
    ])
      .then(([list, people]) => {
        if (cancel) return;
        setData(list);
        setStaff(people.staff);
        setLoadError("");
        setActive((current) => {
          if (!current) return current;
          return list.items.find((row) => row.id === current.id) || current;
        });
      })
      .catch((err) => {
        if (!cancel) setLoadError(messageOf(err, "Could not load tickets"));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [query.q, query.status, query.priority, query.category, query.assignedTo, query.page, query.pageSize, tick]);

  useEffect(() => {
    if (!createOpen || picked) return;
    const typed = customerQ.trim();
    if (typed.length < 2) {
      setHits([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const gen = ++searchGen.current;
    const handle = window.setTimeout(() => {
      setSearching(true);
      searchOnboardCustomersFn({ data: { q: typed } })
        .then((res) => {
          if (searchGen.current !== gen) return;
          setHits(res.customers.map((row) => ({ id: row.id, name: row.name, phone: row.phone, account_number: row.account_number })));
          setSearchError("");
        })
        .catch((err) => {
          if (searchGen.current !== gen) return;
          setHits([]);
          setSearchError(messageOf(err, "Customer search failed"));
        })
        .finally(() => {
          if (searchGen.current === gen) setSearching(false);
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [customerQ, createOpen, picked]);

  useEffect(() => {
    if (!picked) {
      setServices([]);
      setServiceId("");
      return;
    }
    let cancel = false;
    ticketCustomerServices({ data: { customer_id: picked.id } })
      .then((res) => {
        if (cancel) return;
        setServices(res.services);
        setServiceId(res.services.length === 1 ? res.services[0].id : "");
      })
      .catch(() => {
        if (!cancel) setServices([]);
      });
    return () => {
      cancel = true;
    };
  }, [picked]);

  function openCreate() {
    setCreateOpen(true);
    setPicked(null);
    setCustomerQ("");
    setHits([]);
    setTitle("");
    setCategory("performance");
    setPriority("normal");
    setServiceId("");
    setAssigned("");
    setFormError("");
    setSearchError("");
    setServices([]);
  }

  async function submitTicket(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    if (!picked) {
      setFormError("Choose a customer");
      return;
    }
    if (!title.trim()) {
      setFormError("Subject is required");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setFormError("");
    try {
      const opened = await createTicket({
        data: {
          title: title.trim(),
          category,
          priority,
          customer_id: picked.id,
          service_id: serviceId,
          assigned_to: assigned,
        },
      });
      setNotice(`Ticket ${opened.id} created.`);
      setCreateOpen(false);
      setQ("");
      write({ status: "open", q: "", priority: "all", category: "all", assignedTo: "all" });
      setTick((n) => n + 1);
    } catch (err) {
      setFormError(messageOf(err, "Could not create the ticket"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (data!.page - 1) * data!.pageSize + 1;
  const to = data ? Math.min(data.page * data.pageSize, total) : 0;
  const pages = data?.totalPages ?? 1;
  const numbers = pageWindow(data?.page ?? 1, pages);

  return (
    <div className="space-y-6">
      <TicketLive
        onEvent={(summary) => {
          setNotice(summary);
          setTick((n) => n + 1);
        }}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted">Manage customer support requests and technical issues.</p>
        </div>
        {canCreate ? (
          <Button type="button" onClick={openCreate}>
            <Plus className="size-4" strokeWidth={1.75} />
            New ticket
          </Button>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {(
          [
            ["open", "Open", data?.counts.open ?? 0],
            ["new", "New", data?.counts.new ?? 0],
            ["waiting", "Waiting", data?.counts.waiting ?? 0],
            ["resolved", "Resolved", data?.counts.resolved ?? 0],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={cn("bg-surface px-4 py-3 text-left", query.status === id && "bg-accent/10")}
            onClick={() => write({ status: id })}
          >
            <div className="text-2xl font-semibold tabular-nums">{data ? count : "—"}</div>
            <div className="text-xs text-muted">{label}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" strokeWidth={1.75} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tickets"
            className="pl-10"
            aria-label="Search tickets"
          />
        </div>
        <Select aria-label="Status" value={query.status} onChange={(e) => write({ status: e.target.value })}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Priority" value={query.priority} onChange={(e) => write({ priority: e.target.value })}>
          <option value="all">Any priority</option>
          {PRIORITIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Assigned to" value={query.assignedTo} onChange={(e) => write({ assignedTo: e.target.value })}>
          <option value="all">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {staff.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Category" value={query.category} onChange={(e) => write({ category: e.target.value })}>
          <option value="all">Any category</option>
          {FILTER_CATEGORIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {loading && !data ? <TicketSkeleton /> : null}
      {data && data.counts.all === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center">
          <h2 className="font-medium">No tickets yet</h2>
          <p className="mt-1 text-sm text-muted">Create a ticket to start managing customer support requests.</p>
          {canCreate ? (
            <Button type="button" className="mt-4" onClick={openCreate}>
              Create ticket
            </Button>
          ) : null}
        </div>
      ) : null}
      {data && data.counts.all > 0 && data.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center">
          <h2 className="font-medium">No tickets found</h2>
          <p className="mt-1 text-sm text-muted">There are no tickets matching your current filters.</p>
        </div>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className={cn(loading && "opacity-70")} aria-busy={loading}>
          <ul className="space-y-2 md:hidden">
            {data.items.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  className="w-full rounded-xl border border-border bg-surface p-4 text-left"
                  onClick={() => {
                    setActionError("");
                    setUpdating(false);
                    setComment("");
                    setActive(ticket);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono text-xs text-muted">{ticket.id}</span>
                    <Badge tone={ticketPriorityTone(ticket.priority)}>{ticket.priority}</Badge>
                  </div>
                  <div className="mt-1 break-words font-medium">{ticket.title}</div>
                  <div className="mt-1 text-sm text-muted">
                    {ticket.customer_name || "No customer"}
                    {ticket.customer_phone ? ` · ${ticket.customer_phone}` : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone={ticketStatusTone(ticket.status)}>{labelize(ticket.status)}</Badge>
                    <span>{staffName(ticket.assigned_to)}</span>
                    <span>{formatRelativeTime(ticket.updated_at)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Priority</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="hidden px-4 py-3 font-medium xl:table-cell">Assigned</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((ticket) => (
                  <tr
                    key={ticket.id}
                    tabIndex={0}
                    className="cursor-pointer align-top hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                    onClick={() => {
                      setActionError("");
                      setUpdating(false);
                      setComment("");
                      setActive(ticket);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActive(ticket);
                      }
                    }}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted">{ticket.id}</td>
                    <td className="px-4 py-3">
                      <div>{ticket.customer_name || "No customer"}</div>
                      {ticket.customer_account ? <div className="text-xs text-muted">{ticket.customer_account}</div> : null}
                    </td>
                    <td className="px-4 py-3 font-medium">{ticket.title}</td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <Badge tone={ticketPriorityTone(ticket.priority)}>{ticket.priority}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={ticketStatusTone(ticket.status)}>{labelize(ticket.status)}</Badge>
                    </td>
                    <td className="hidden px-4 py-3 text-muted xl:table-cell">{staffName(ticket.assigned_to)}</td>
                    <td className="hidden px-4 py-3 text-muted lg:table-cell">{formatRelativeTime(ticket.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {data && total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <p>
            Showing {from}–{to} of {total} ticket{total === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Tickets per page"
              className="h-9 w-24"
              value={String(query.pageSize)}
              onChange={(e) => write({ pageSize: Number(e.target.value) })}
            >
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </Select>
            {pages > 1 ? (
              <>
                <Button type="button" size="sm" variant="secondary" disabled={data.page <= 1} onClick={() => write({ page: data.page - 1 }, true)}>
                  Previous
                </Button>
                <div className="hidden items-center gap-1 sm:flex">
                  {numbers.map((n) => (
                    <Button key={n} type="button" size="sm" variant={n === data.page ? "default" : "ghost"} onClick={() => write({ page: n }, true)}>
                      {n}
                    </Button>
                  ))}
                </div>
                <span className="px-1 tabular-nums sm:hidden">
                  {data.page} / {pages}
                </span>
                <Button type="button" size="sm" variant="secondary" disabled={data.page >= pages} onClick={() => write({ page: data.page + 1 }, true)}>
                  Next
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (!busy) setCreateOpen(next);
        }}
        title="Create new ticket"
        description="Search for the customer first, then enter the ticket."
        className="sm:max-w-xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-ticket" disabled={busy || !picked}>
              {busy ? "Creating ticket..." : "Create ticket"}
            </Button>
          </div>
        }
      >
        <form id="new-ticket" className="grid gap-4" onSubmit={submitTicket}>
          {picked ? (
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted">Customer</div>
              <div className="mt-1 font-medium">{picked.name}</div>
              <div className="text-sm text-muted">{[picked.phone, picked.account_number].filter(Boolean).join(" · ")}</div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-2 px-0"
                onClick={() => {
                  setPicked(null);
                  setServiceId("");
                  setServices([]);
                }}
              >
                Change customer
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              <Field label="Customer">
                <Input
                  autoFocus
                  value={customerQ}
                  onChange={(e) => setCustomerQ(e.target.value)}
                  placeholder="Search customer by name, phone, or account"
                  aria-label="Search customer"
                />
              </Field>
              {customerQ.trim().length > 0 && customerQ.trim().length < 2 ? (
                <p className="text-xs text-muted">Type at least 2 characters.</p>
              ) : null}
              {searching ? <p className="text-xs text-muted">Searching customers…</p> : null}
              {searchError ? <p className="text-sm text-danger">{searchError}</p> : null}
              {!searching && customerQ.trim().length >= 2 && hits.length === 0 && !searchError ? (
                <p className="text-sm text-muted">No customers found.</p>
              ) : null}
              <ul className="grid gap-2">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-accent/5"
                      onClick={() => setPicked(hit)}
                    >
                      <div className="font-medium">{hit.name}</div>
                      <div className="text-xs text-muted">{[hit.phone, hit.account_number].filter(Boolean).join(" · ")}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {picked ? (
            <>
              <Field label="Subject">
                <Input required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Category">
                  <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CREATE_CATEGORIES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {PRIORITIES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {services.length > 0 ? (
                <Field label="Service">
                  <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                    {services.length > 1 ? <option value="">Select customer service</option> : null}
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {serviceChoice(service)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-xs text-muted">This customer has no service to attach.</p>
              )}
              <Field label="Assigned to">
                <Select value={assigned} onChange={(e) => setAssigned(e.target.value)}>
                  <option value="">Unassigned</option>
                  {staff.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          {formError ? <p className="text-sm text-danger">{formError}</p> : null}
        </form>
      </Dialog>

      <Dialog
        open={Boolean(active)}
        onOpenChange={(next) => {
          if (!next) setActive(null);
        }}
        title={active?.title || "Ticket"}
        description={active ? `${active.id} · ${active.customer_name || "No customer"}` : undefined}
        className="sm:max-w-xl"
      >
        {active ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ticketStatusTone(active.status)}>{labelize(active.status)}</Badge>
              <Badge tone={ticketPriorityTone(active.priority)}>{active.priority}</Badge>
              <span className="text-xs text-muted">{labelize(active.category)}</span>
            </div>
            <div className="text-sm text-muted">
              <div>{[active.customer_phone, active.customer_account].filter(Boolean).join(" · ") || "No contact on file"}</div>
              <div className="mt-1">
                {staffName(active.assigned_to)} · updated {formatRelativeTime(active.updated_at)}
              </div>
            </div>
            {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
            <TicketActions
              ticket={active}
              staff={staff}
              updating={updating}
              comment={comment}
              canAssign={canAssign}
              canUpdate={canUpdate}
              onAssign={async (userId) => {
                try {
                  await assignOpenTicket({ data: { id: active.id, user_id: userId } });
                  setActive({ ...active, assigned_to: userId, status: active.status === "new" ? "assigned" : active.status });
                  setActionError("");
                  setTick((n) => n + 1);
                } catch (err) {
                  setActionError(messageOf(err, "Could not assign the ticket"));
                }
              }}
              onClose={async () => {
                try {
                  await setTicketStatus({ data: { id: active.id, status: "closed" } });
                  setActive({ ...active, status: "closed" });
                  setActionError("");
                  setTick((n) => n + 1);
                } catch (err) {
                  setActionError(messageOf(err, "Could not close the ticket"));
                }
              }}
              onToggleUpdate={() => setUpdating((v) => !v)}
              onStatus={async (status) => {
                try {
                  await setTicketStatus({ data: { id: active.id, status } });
                  setActive({ ...active, status });
                  setActionError("");
                  setTick((n) => n + 1);
                } catch (err) {
                  setActionError(messageOf(err, "Could not update the ticket"));
                }
              }}
              onCommentChange={setComment}
              onSaveNote={async (visibleToCustomer) => {
                const body = comment.trim();
                if (!body) return;
                try {
                  await commentOpenTicket({ data: { id: active.id, body, internal: !visibleToCustomer } });
                  setComment("");
                  setUpdating(false);
                  setActionError("");
                  setTick((n) => n + 1);
                } catch (err) {
                  setActionError(messageOf(err, "Could not save the note"));
                }
              }}
            />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
