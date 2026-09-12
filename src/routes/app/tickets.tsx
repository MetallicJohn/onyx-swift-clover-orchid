import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, List, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { TablePad, VirtualGrid, VirtualTableFrame } from "@/components/ui/virtual-scroller";
import { useColumnCount, useTableVirtualizer } from "@/components/ui/use-virtual-scroller";
import { assignOpenTicket, commentOpenTicket, listTicketStaff } from "@/lib/isp/server-more";
import { createTicket, listTickets, setTicketStatus } from "@/lib/isp/server";
import { hasPermission } from "@/lib/isp/rbac";
import type { TicketRow } from "@/lib/isp/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/tickets")({ component: TicketsPage });

const STATUSES = ["new", "assigned", "accepted", "travelling", "on_site", "waiting", "resolved", "closed"];
const CLOSED = new Set(["resolved", "closed"]);
const CATEGORIES = ["performance", "billing", "network", "hotspot", "install"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const PAGE_SIZES = [10, 20, 50, 100] as const;
const STATUS_CHIPS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
] as const;

type StatusChip = (typeof STATUS_CHIPS)[number]["id"];
type StaffMember = { user_id: string; role: string; name: string };
type ViewMode = "grid" | "list";

const EMPTY_FORM = { title: "", category: "performance", priority: "normal", customer_id: "" };

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
  ticket: TicketRow;
  staff: StaffMember[];
  updating: boolean;
  comment: string;
  onAssign: (userId: string) => void;
  onClose: () => void;
  onToggleUpdate: () => void;
  onStatus: (status: string) => void;
  onCommentChange: (value: string) => void;
  onSaveNote: () => void;
  canAssign: boolean;
  canUpdate: boolean;
}) {
  const done = CLOSED.has(ticket.status);
  return (
    <div className="grid gap-2">
      {canAssign || canUpdate ? (
      <div className="flex items-center gap-2">
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
        <Button size="sm" variant="secondary" className="shrink-0" disabled={done} onClick={onToggleUpdate}>
          Update
        </Button>
        ) : null}
        {canUpdate ? (
        <Button size="sm" variant={done ? "ghost" : "secondary"} className="shrink-0" disabled={done} onClick={onClose}>
          Close
        </Button>
        ) : null}
      </div>
      ) : null}
      {canUpdate && updating && !done ? (
        <div className="grid gap-2">
          <Select className="h-9" aria-label="Update status" value={ticket.status} onChange={(e) => onStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <Input className="h-9" placeholder="Add a note" value={comment} onChange={(e) => onCommentChange(e.target.value)} />
            <Button size="sm" variant="secondary" className="shrink-0" onClick={onSaveNote}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TicketGrid({ rows, renderCard }: { rows: TicketRow[]; renderCard: (t: TicketRow) => ReactNode }) {
  const columns = useColumnCount(1, 2, 2);
  return <VirtualGrid items={rows} columns={columns} estimateSize={196} renderItem={(t) => renderCard(t)} />;
}

function TicketTable({
  rows,
  staffName,
  actionsFor,
}: {
  rows: TicketRow[];
  staffName: (id?: string) => string;
  actionsFor: (t: TicketRow) => ReactNode;
}) {
  const { parentRef, virtualizer, rows: vis, padTop, padBottom } = useTableVirtualizer(rows.length, 108);
  return (
    <VirtualTableFrame parentRef={parentRef} className="rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface text-xs text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Ticket</th>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Priority</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <TablePad height={padTop} colSpan={5} />
          {vis.map((v) => {
            const t = rows[v.index];
            return (
              <tr key={t.id} data-index={v.index} ref={virtualizer.measureElement} className="align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{t.title}</div>
                  <div className="text-xs text-muted">
                    {t.category}
                    {t.assigned_to ? ` · ${staffName(t.assigned_to)}` : ""}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{t.customer_name ?? "Network"}</td>
                <td className="px-4 py-3 capitalize">{t.priority}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(t.status)}>{t.status.replace("_", " ")}</Badge>
                </td>
                <td className="min-w-[20rem] px-4 py-3">{actionsFor(t)}</td>
              </tr>
            );
          })}
          <TablePad height={padBottom} colSpan={5} />
        </tbody>
      </table>
    </VirtualTableFrame>
  );
}

function TicketsPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusChip, setStatusChip] = useState<StatusChip>("open");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [view, setView] = useState<ViewMode>("grid");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState("");

  async function load() {
    const [res, s] = await Promise.all([listTickets(), listTicketStaff()]);
    setTickets(res.tickets);
    setCustomers(res.customers);
    setStaff(s.staff);
    setRole(res.workspace.role);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  function staffName(userId?: string) {
    if (!userId) return "";
    return staff.find((s) => s.user_id === userId)?.name || userId.slice(-6);
  }

  const openCount = tickets.filter((t) => !CLOSED.has(t.status)).length;
  const closedCount = tickets.length - openCount;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (statusChip === "open" && CLOSED.has(t.status)) return false;
      if (statusChip === "closed" && !CLOSED.has(t.status)) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (assigneeFilter === "unassigned" && t.assigned_to) return false;
      if (assigneeFilter !== "all" && assigneeFilter !== "unassigned" && t.assigned_to !== assigneeFilter) return false;
      if (!needle) return true;
      const who = t.assigned_to ? staff.find((s) => s.user_id === t.assigned_to)?.name || "" : "";
      const hay = `${t.title} ${t.customer_name ?? "network"} ${t.category} ${t.priority} ${t.status} ${who}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [tickets, query, statusChip, statusFilter, priorityFilter, categoryFilter, assigneeFilter, staff]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const from = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, filtered.length);
  const canCreate = hasPermission(role, "tickets.manage");

  useEffect(() => {
    setPage(1);
  }, [query, statusChip, statusFilter, priorityFilter, categoryFilter, assigneeFilter, pageSize]);

  function actionsFor(t: TicketRow) {
    return (
      <TicketActions
        ticket={t}
        staff={staff}
        updating={updating === t.id}
        comment={comment[t.id] || ""}
        onAssign={async (userId) => {
          await assignOpenTicket({ data: { id: t.id, user_id: userId } });
          await load();
        }}
        onClose={async () => {
          await setTicketStatus({ data: { id: t.id, status: "closed" } });
          await load();
        }}
        onToggleUpdate={() => setUpdating(updating === t.id ? null : t.id)}
        onStatus={async (status) => {
          await setTicketStatus({ data: { id: t.id, status } });
          await load();
        }}
        onCommentChange={(value) => setComment({ ...comment, [t.id]: value })}
        onSaveNote={async () => {
          const body = (comment[t.id] || "").trim();
          if (!body) return;
          await commentOpenTicket({ data: { id: t.id, body } });
          setComment({ ...comment, [t.id]: "" });
          setUpdating(null);
        }}
        canAssign={hasPermission(role, "tickets.manage")}
        canUpdate={hasPermission(role, "tickets.manage") || hasPermission(role, "jobs.update")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted">Dispatch with SLA, assignment, and comments. Field app only sees assigned jobs.</p>
        </div>
        {canCreate ? (
        <Button
          onClick={() => {
            setOpen(true);
            setForm(EMPTY_FORM);
          }}
        >
          New ticket
        </Button>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" strokeWidth={1.75} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, customer, or assignee"
            className="pl-10"
            aria-label="Search tickets"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {STATUS_CHIPS.map((chip) => (
              <Button
                key={chip.id}
                size="sm"
                variant={statusChip === chip.id ? "default" : "secondary"}
                onClick={() => {
                  setStatusChip(chip.id);
                  setStatusFilter("all");
                }}
              >
                {chip.label}
                {chip.id === "open" ? ` (${openCount})` : chip.id === "closed" ? ` (${closedCount})` : ` (${tickets.length})`}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border bg-surface p-1" role="group" aria-label="View">
              <button
                type="button"
                aria-pressed={view === "grid"}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-md",
                  view === "grid" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
                )}
                onClick={() => setView("grid")}
              >
                <LayoutGrid className="size-4" strokeWidth={1.75} />
                <span className="sr-only">Grid view</span>
              </button>
              <button
                type="button"
                aria-pressed={view === "list"}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-md",
                  view === "list" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
                )}
                onClick={() => setView("list")}
              >
                <List className="size-4" strokeWidth={1.75} />
                <span className="sr-only">List view</span>
              </button>
            </div>
            <Select
              aria-label="Tickets per page"
              className="h-9 w-28"
              value={String(pageSize)}
              onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number])}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              const value = e.target.value;
              setStatusFilter(value);
              if (value === "all") return;
              setStatusChip(CLOSED.has(value) ? "closed" : "open");
            }}
          >
            <option value="all">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by priority" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="all">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">Any category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by assignee" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
            <option value="all">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {staff.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {canCreate && open ? (
        <form
          className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await createTicket({ data: form });
              setForm(EMPTY_FORM);
              setOpen(false);
              await load();
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="font-medium md:col-span-2">New ticket</h2>
          <Field label="Title">
            <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Customer">
            <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">Network / unassigned</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="performance">Performance</option>
              <option value="billing">Billing</option>
              <option value="network">Network</option>
              <option value="hotspot">Hotspot</option>
              <option value="install">Installation</option>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Create ticket"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {tickets.length === 0 ? (
        <p className="text-sm text-muted">No tickets yet.{canCreate ? " Click New ticket to open one." : ""}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">No tickets match these filters.</p>
      ) : view === "grid" ? (
        <TicketGrid rows={pageRows} renderCard={(t) => {
          const assignee = staffName(t.assigned_to);
          return (
            <article key={t.id} className="flex h-full flex-col rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {t.customer_name ?? "Network"} · {t.category} · {t.priority}
                    {assignee ? ` · ${assignee}` : ""}
                  </div>
                </div>
                <Badge tone={statusTone(t.status)}>{t.status.replace("_", " ")}</Badge>
              </div>
              <div className="mt-3">{actionsFor(t)}</div>
            </article>
          );
        }} />
      ) : (
        <TicketTable
          rows={pageRows}
          staffName={staffName}
          actionsFor={actionsFor}
        />
      )}

      {filtered.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <p>
            {from}–{to} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              Previous
            </Button>
            <span className="px-1 tabular-nums">
              {currentPage} / {pages}
            </span>
            <Button size="sm" variant="secondary" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
