import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Communications } from "@/components/isp/communications";
import { TagList, TagPicker } from "@/components/isp/tag-picker";
import { Button } from "@/components/ui/button";
import { Badge, statusTone } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { TablePad, VirtualTableFrame } from "@/components/ui/virtual-scroller";
import { useTableVirtualizer } from "@/components/ui/use-virtual-scroller";
import { createCustomer, listCustomers, setCustomerPortalPassword, updateCustomer } from "@/lib/isp/server";
import { getAccountNumberSettingsFn } from "@/lib/isp/server-account-numbers";
import { hasPermission } from "@/lib/isp/rbac";
import { broadcastCustomersFn, bulkCustomerTagsFn } from "@/lib/isp/server-tags";
import type { CustomerRow } from "@/lib/isp/types";
import { cn, kes } from "@/lib/utils";

type PageTab = "customers" | "communications";

export const Route = createFileRoute("/app/customers")({
  validateSearch: (search: Record<string, unknown>): { tab?: PageTab } => ({
    tab: search.tab === "communications" ? "communications" : undefined,
  }),
  component: CustomersPage,
});

type CatalogTag = { id: string; name: string; slug: string; enabled: boolean; customer_count: number };
type BulkMode = "tags-add" | "tags-remove" | "sms" | "notify" | null;
type StatusFilter = "all" | "active" | "suspended" | "expired";
type AccessFilter = "all" | "pppoe" | "static" | "hotspot";

const EMPTY_FORM = {
  name: "",
  phone: "",
  email: "",
  address: "",
  type: "individual",
  portal_password: "",
  tag_ids: [] as string[],
  account_number: "",
};

function churnTone(band: string) {
  if (band === "high" || band === "churned") return "danger" as const;
  if (band === "medium") return "warn" as const;
  return "ok" as const;
}

function hasTags(assigned: string[], selected: string[], mode: "any" | "all") {
  if (!selected.length) return true;
  if (mode === "all") return selected.every((id) => assigned.includes(id));
  return selected.some((id) => assigned.includes(id));
}

function CustomerTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  allSelected,
  portalFor,
  portalPass,
  setPortalFor,
  setPortalPass,
  onEdit,
  canManage,
  canStatements,
}: {
  rows: CustomerRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  portalFor: string | null;
  portalPass: string;
  setPortalFor: (id: string | null) => void;
  setPortalPass: (value: string) => void;
  onEdit: (c: CustomerRow) => void;
  canManage: boolean;
  canStatements: boolean;
}) {
  const { parentRef, virtualizer, rows: vis, padTop, padBottom } = useTableVirtualizer(rows.length, 96);
  return (
    <VirtualTableFrame parentRef={parentRef} className="rounded-xl bg-surface shadow-card">
      <table className="w-full min-w-[62rem] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface text-xs text-muted">
          <tr>
            <th className="px-3 py-3">
              {canManage ? (
                <input type="checkbox" className="size-4" checked={allSelected} onChange={onToggleAll} aria-label="Select all filtered customers" />
              ) : null}
            </th>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Account</th>
            <th className="px-4 py-3 font-medium">Contact</th>
            <th className="px-4 py-3 font-medium">Tags</th>
            <th className="px-4 py-3 font-medium">Services</th>
            <th className="px-4 py-3 font-medium">Balance</th>
            <th className="px-4 py-3 font-medium">Churn</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <TablePad height={padTop} colSpan={10} />
          {vis.map((v) => {
            const c = rows[v.index];
            return (
              <tr key={c.id} data-index={v.index} ref={virtualizer.measureElement}>
                <td className="px-3 py-3">
                  {canManage ? (
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selected.has(c.id)}
                      onChange={() => onToggle(c.id)}
                      aria-label={`Select ${c.name}`}
                    />
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted capitalize">{c.type}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{c.account_number || "—"}</td>
                <td className="px-4 py-3 text-muted">
                  <div>{c.phone}</div>
                  <div className="text-xs">{c.email}</div>
                </td>
                <td className="px-4 py-3">
                  <TagList tags={c.tags ?? []} />
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">{c.service_count}</td>
                <td className="px-4 py-3 font-mono tabular-nums">{kes(c.balance_kes)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs tabular-nums">{c.churn_score}</span>
                    <Badge tone={churnTone(c.churn_band)}>{c.churn_band}</Badge>
                  </div>
                  {c.churn_reason ? <div className="mt-1 max-w-[12rem] truncate text-xs text-subtle">{c.churn_reason}</div> : null}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(c.line_status || c.status)}>{c.line_status || c.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-2">
                    {canManage ? (
                      <Button size="sm" variant="ghost" onClick={() => onEdit(c)}>
                        Edit
                      </Button>
                    ) : null}
                    {canStatements ? (
                      <a href={`/app/statements?customer=${c.id}`} className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">
                        Statement
                      </a>
                    ) : null}
                    {canManage ? (
                      portalFor === c.id ? (
                      <form
                        className="flex flex-col gap-2 sm:flex-row"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await setCustomerPortalPassword({ data: { customer_id: c.id, password: portalPass } });
                          setPortalFor(null);
                          setPortalPass("");
                        }}
                      >
                        <Input
                          type="password"
                          required
                          minLength={8}
                          value={portalPass}
                          onChange={(e) => setPortalPass(e.target.value)}
                          placeholder="New portal password"
                          autoComplete="new-password"
                        />
                        <Button type="submit" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="text-sm text-muted hover:text-fg"
                        onClick={() => {
                          setPortalFor(c.id);
                          setPortalPass("");
                        }}
                      >
                        Portal password
                      </button>
                    )
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          <TablePad height={padBottom} colSpan={10} />
        </tbody>
      </table>
    </VirtualTableFrame>
  );
}

function CustomersPage() {
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [tags, setTags] = useState<CatalogTag[]>([]);
  const [packages, setPackages] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState<"all" | "watch">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [access, setAccess] = useState<AccessFilter>("all");
  const [pkg, setPkg] = useState("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"any" | "all">("any");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [accPolicy, setAccPolicy] = useState<{ enabled: boolean; allow_manual: boolean; preview: string }>({
    enabled: false,
    allow_manual: false,
    preview: "",
  });
  const [portalFor, setPortalFor] = useState<string | null>(null);
  const [portalPass, setPortalPass] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkMode>(null);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkBody, setBulkBody] = useState("");
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [role, setRole] = useState("");

  async function load() {
    const res = await listCustomers();
    setRows(res.customers);
    setTags(res.tags ?? []);
    setPackages(res.packages ?? []);
    setRole(res.workspace.role);
    try {
      const policy = await getAccountNumberSettingsFn();
      setAccPolicy({ enabled: policy.enabled, allow_manual: policy.allow_manual, preview: policy.preview });
    } catch {
      setAccPolicy({ enabled: false, allow_manual: false, preview: "" });
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (risk === "watch" && r.churn_band === "low") return false;
      if (status !== "all" && (r.line_status || r.status) !== status) return false;
      if (access !== "all" && !(r.access_methods ?? []).includes(access)) return false;
      if (pkg !== "all" && !(r.package_names ?? []).includes(pkg)) return false;
      const assigned = (r.tags ?? []).map((t) => t.id);
      if (!hasTags(assigned, tagFilter, tagMode)) return false;
      if (!needle) return true;
      const hay = `${r.name} ${r.phone} ${r.email} ${r.address} ${r.account_number ?? ""} ${(r.tags ?? []).map((t) => t.name).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, risk, status, access, pkg, tagFilter, tagMode]);

  const watching = rows.filter((r) => r.churn_band !== "low").length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const selectedIds = filtered.filter((c) => selected.has(c.id)).map((c) => c.id);
  const canManage = hasPermission(role, "customers.manage");
  const canStatements = hasPermission(role, "invoices.read");
  const canComms = hasPermission(role, "communications.view");
  const canSettings = hasPermission(role, "settings.manage");
  const tab: PageTab = tabParam === "communications" && canComms ? "communications" : "customers";

  function startCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, account_number: accPolicy.enabled ? accPolicy.preview : "" });
    setOpen(true);
  }

  function startEdit(c: CustomerRow) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      type: c.type,
      portal_password: "",
      tag_ids: (c.tags ?? []).map((t) => t.id),
      account_number: c.account_number || "",
    });
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editingId) {
        const previous = rows.find((r) => r.id === editingId)?.account_number || "";
        if (form.account_number !== previous) {
          if (!accPolicy.allow_manual) {
            throw new Error("Manual editing of account numbers is turned off.");
          }
          if (
            !window.confirm(
              `Change account number from ${previous || "(none)"} to ${form.account_number || "(none)"}? Invoices, services, and history stay on this customer.`,
            )
          ) {
            setBusy(false);
            return;
          }
        }
        await updateCustomer({
          data: {
            id: editingId,
            name: form.name,
            phone: form.phone,
            email: form.email,
            address: form.address,
            type: form.type,
            tag_ids: form.tag_ids,
            account_number: form.account_number,
          },
        });
      } else {
        await createCustomer({
          data: {
            name: form.name,
            phone: form.phone,
            email: form.email,
            address: form.address,
            type: form.type,
            portal_password: form.portal_password || undefined,
            tag_ids: form.tag_ids,
            account_number: form.account_number || undefined,
          },
        });
      }
      setOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not save customer");
    } finally {
      setBusy(false);
    }
  }

  async function runBulk() {
    if (!selectedIds.length) return;
    setBusy(true);
    setBulkNote(null);
    try {
      if (bulk === "tags-add" || bulk === "tags-remove") {
        const res = await bulkCustomerTagsFn({
          data: { customer_ids: selectedIds, tag_ids: bulkTags, op: bulk === "tags-add" ? "add" : "remove" },
        });
        setBulkNote(`${bulk === "tags-add" ? "Assigned" : "Removed"} on ${res.customers} customers.`);
      } else if (bulk === "sms" || bulk === "notify") {
        const res = await broadcastCustomersFn({
          data: {
            customer_ids: selectedIds,
            channels: bulk === "sms" ? ["sms"] : ["in_app"],
            subject: bulkSubject,
            body: bulkBody,
          },
        });
        setBulkNote(
          bulk === "sms"
            ? `SMS queued for ${res.sms} · failed ${res.failed}`
            : `Notification sent to ${res.inbox} customers`,
        );
      }
      setBulk(null);
      setBulkTags([]);
      setBulkBody("");
      setBulkSubject("");
      await load();
    } catch (err) {
      setBulkNote(err instanceof Error ? err.message : "Could not complete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted">
            {tab === "communications"
              ? "Bulk SMS alerts and announcements to the right group of customers."
              : "CRM with balances, tags, and a live churn score from billing, access, and tickets."}
          </p>
        </div>
        {tab === "customers" && canManage ? <Button onClick={startCreate}>New customer</Button> : null}
      </div>

      <div
        role="tablist"
        aria-label="Customer sections"
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
      >
        {(
          [
            ["customers", "Customers"],
            ...(canComms ? [["communications", "Communications"] as const] : []),
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              "h-11 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors",
              tab === id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={() => void navigate({ search: { tab: id === "customers" ? undefined : id }, replace: true })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "communications" ? <Communications /> : null}

      {tab === "customers" ? (
      <>
      <div className="space-y-3">
        <Input placeholder="Search name, account number, phone, email, address, or tag" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={risk === "all" && status === "all" ? "default" : "secondary"} onClick={() => { setRisk("all"); setStatus("all"); }}>
            All ({rows.length})
          </Button>
          <Button size="sm" variant={status === "active" ? "default" : "secondary"} onClick={() => setStatus(status === "active" ? "all" : "active")}>
            Active
          </Button>
          <Button size="sm" variant={status === "suspended" ? "default" : "secondary"} onClick={() => setStatus(status === "suspended" ? "all" : "suspended")}>
            Suspended
          </Button>
          <Button size="sm" variant={status === "expired" ? "default" : "secondary"} onClick={() => setStatus(status === "expired" ? "all" : "expired")}>
            Expired
          </Button>
          <Button size="sm" variant={risk === "watch" ? "default" : "secondary"} onClick={() => setRisk(risk === "watch" ? "all" : "watch")}>
            At risk ({watching})
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Select aria-label="Filter by access" value={access} onChange={(e) => setAccess(e.target.value as AccessFilter)}>
            <option value="all">Any access</option>
            <option value="pppoe">PPPoE</option>
            <option value="static">Static IP</option>
            <option value="hotspot">Hotspot</option>
          </Select>
          <Select aria-label="Filter by package" value={pkg} onChange={(e) => setPkg(e.target.value)}>
            <option value="all">Any package</option>
            {packages.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Select aria-label="Tag match" value={tagMode} onChange={(e) => setTagMode(e.target.value as "any" | "all")}>
            <option value="any">Any selected tag</option>
            <option value="all">All selected tags</option>
          </Select>
        </div>
        {tags.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((t) => {
              const on = tagFilter.includes(t.id);
              return (
                <Button
                  key={t.id}
                  size="sm"
                  variant={on ? "default" : "secondary"}
                  className={!t.enabled ? "opacity-60" : undefined}
                  onClick={() => setTagFilter(on ? tagFilter.filter((id) => id !== t.id) : [...tagFilter, t.id])}
                >
                  {t.name} ({t.customer_count})
                </Button>
              );
            })}
            {canSettings ? (
              <Link to="/app/settings" search={{ tab: "tags" }} className="text-sm text-accent hover:underline">
                Manage tags
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No tags yet.
            {canSettings ? (
              <>
                {" "}
                <Link to="/app/settings" search={{ tab: "tags" }} className="text-accent hover:underline">
                  Create customer tags
                </Link>
              </>
            ) : null}
          </p>
        )}
      </div>

      {canManage && selectedIds.length ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {selectedIds.length} selected of {filtered.length} matching
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={bulk === "tags-add" ? "default" : "secondary"} onClick={() => setBulk("tags-add")}>
                Assign tags
              </Button>
              <Button size="sm" variant={bulk === "tags-remove" ? "default" : "secondary"} onClick={() => setBulk("tags-remove")}>
                Remove tags
              </Button>
              <Button size="sm" variant={bulk === "sms" ? "default" : "secondary"} onClick={() => setBulk("sms")}>
                Send SMS
              </Button>
              <Button size="sm" variant={bulk === "notify" ? "default" : "secondary"} onClick={() => setBulk("notify")}>
                Send notification
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelected(new Set());
                  setBulk(null);
                }}
              >
                Clear
              </Button>
            </div>
          </div>
          {bulk === "tags-add" || bulk === "tags-remove" ? (
            <div className="space-y-3">
              <TagPicker tags={tags} selected={bulkTags} onChange={setBulkTags} />
              <Button disabled={busy || !bulkTags.length} onClick={() => void runBulk()}>
                {bulk === "tags-add" ? "Assign to selected" : "Remove from selected"}
              </Button>
            </div>
          ) : null}
          {bulk === "sms" || bulk === "notify" ? (
            <div className="grid gap-3 md:max-w-xl">
              {bulk === "notify" ? (
                <Field label="Subject">
                  <Input value={bulkSubject} onChange={(e) => setBulkSubject(e.target.value)} />
                </Field>
              ) : null}
              <Field label={bulk === "sms" ? "SMS" : "Message"}>
                <Textarea value={bulkBody} onChange={(e) => setBulkBody(e.target.value)} required />
              </Field>
              <Button disabled={busy || !bulkBody.trim()} onClick={() => void runBulk()}>
                {bulk === "sms" ? "Send SMS" : "Send notification"}
              </Button>
            </div>
          ) : null}
          {bulkNote ? <p className="text-sm text-accent">{bulkNote}</p> : null}
        </div>
      ) : null}

      {canManage && open ? (
        <form onSubmit={submit} className="grid gap-3 rounded-xl bg-surface p-5 shadow-card md:grid-cols-2 md:p-6">
          <h2 className="font-medium md:col-span-2">{editingId ? "Edit customer" : "New customer"}</h2>
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="individual">Individual</option>
              <option value="business">Business</option>
            </Select>
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Address / location">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          {accPolicy.enabled || accPolicy.allow_manual || (editingId && form.account_number) ? (
            <Field label="Account number">
              <Input
                value={form.account_number}
                readOnly={editingId ? !accPolicy.allow_manual : accPolicy.enabled && !accPolicy.allow_manual}
                onChange={(e) => setForm({ ...form, account_number: e.target.value.toUpperCase() })}
                placeholder={accPolicy.enabled ? accPolicy.preview : "Optional"}
              />
            </Field>
          ) : null}
          {accPolicy.enabled && !editingId ? (
            <p className="text-xs text-subtle md:col-span-2">
              Next number {accPolicy.preview}. It is reserved when you save, so two staff cannot get the same account.
              {canSettings ? (
                <>
                  {" "}
                  <Link to="/app/settings" search={{ tab: "accounts" }} className="text-accent hover:underline">
                    Change format
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {!editingId ? (
            <Field label="Portal password (optional)">
              <Input
                type="password"
                minLength={8}
                value={form.portal_password}
                onChange={(e) => setForm({ ...form, portal_password: e.target.value })}
                placeholder="Customer can sign in at /portal"
              />
            </Field>
          ) : null}
          <div className="md:col-span-2">
            <Field label="Tags">
              <TagPicker tags={tags} selected={form.tag_ids} onChange={(tag_ids) => setForm({ ...form, tag_ids })} />
            </Field>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No customers yet.{canManage ? " Click New customer to add one." : ""}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">No customers match these filters.</p>
      ) : (
        <CustomerTable
          rows={filtered}
          selected={selected}
          allSelected={allFilteredSelected}
          onToggle={(id) => {
            const next = new Set(selected);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setSelected(next);
          }}
          onToggleAll={() => {
            if (allFilteredSelected) {
              const next = new Set(selected);
              for (const c of filtered) next.delete(c.id);
              setSelected(next);
            } else {
              const next = new Set(selected);
              for (const c of filtered) next.add(c.id);
              setSelected(next);
            }
          }}
          portalFor={portalFor}
          portalPass={portalPass}
          setPortalFor={setPortalFor}
          setPortalPass={setPortalPass}
          onEdit={startEdit}
          canManage={canManage}
          canStatements={canStatements}
        />
      )}
      </>
      ) : null}
    </div>
  );
}
