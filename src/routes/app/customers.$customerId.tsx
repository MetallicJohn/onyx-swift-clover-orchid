import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { TagList, TagPicker } from "@/components/isp/tag-picker";
import { TrafficDrawer } from "@/components/isp/traffic-drawer";
import { ReassignServiceDialog } from "@/components/isp/reassign-service-dialog";
import { ExpiryEditor, type ExpiryForm } from "@/components/isp/service-expiry-editor";
import { OnboardWizard } from "@/components/isp/onboard-wizard";
import { PartialPaymentPanel } from "@/components/isp/partial-payment-panel";
import { BusinessCreditPanel } from "@/components/isp/business-credit-panel";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { accessMethodLabel, formatDate, formatDateTime, formatMac, remainingLabel } from "@/lib/isp/display";
import { accountState, accountStateLabel, customerRecordPath, normalizeProfileSearch, type ProfileTab } from "@/lib/isp/customer-desk-format";
import { hasPermission } from "@/lib/isp/rbac";
import { getAccountNumberSettingsFn } from "@/lib/isp/server-account-numbers";
import { extendGraceFn, grantGraceFn, revokeGraceFn } from "@/lib/isp/server-grace";
import { setServiceExpiryFn } from "@/lib/isp/server-expiry";
import {
  disconnectService,
  rotateServiceSecret,
  setCustomerPortalPassword,
  setServiceStatus,
  updateCustomer,
} from "@/lib/isp/server";
import {
  deleteCustomerFn,
  deleteServiceFn,
  getCustomerFn,
  reassignServiceFn,
} from "@/lib/isp/server-lifecycle";
import { reassignInfoFromRow } from "@/lib/isp/reassign-format";
import { effectiveAccessIso, expirySourceLabel, openExpiryForm } from "@/lib/isp/service-expiry-format";
import type { ServiceRow, ServiceStatus } from "@/lib/isp/types";
import { cn, kes } from "@/lib/utils";

export const Route = createFileRoute("/app/customers/$customerId")({
  validateSearch: (search: Record<string, unknown>) => normalizeProfileSearch(search),
  component: CustomerRecordPage,
});

type RecordData = Awaited<ReturnType<typeof getCustomerFn>>;
type Tab = ProfileTab;
type GraceMode = "grant" | "extend" | "revoke";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "services", label: "Services" },
  { id: "billing", label: "Billing" },
  { id: "tickets", label: "Tickets" },
  { id: "messages", label: "Messages" },
  { id: "activity", label: "Activity" },
];

function CustomerRecordPage() {
  const { customerId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [data, setData] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(search.tab || (search.action === "add-service" ? "services" : "overview"));
  const [editing, setEditing] = useState(search.action === "edit");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    type: "individual",
    account_number: "",
    notes: "",
    tag_ids: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [trafficOpen, setTrafficOpen] = useState(false);
  const [trafficService, setTrafficService] = useState<string | undefined>(undefined);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [provisionOpen, setProvisionOpen] = useState(search.action === "add-service");
  const [expiry, setExpiry] = useState<ExpiryForm | null>(null);
  const [grace, setGrace] = useState<{ id: string; mode: GraceMode } | null>(null);
  const [reassign, setReassign] = useState<{
    id: string;
    customer_id: string;
    customer_name: string;
    customer_phone?: string;
    customer_account_number?: string;
    account_number?: string;
    package_name: string;
    access_method: string;
    status: string;
    period_end?: string | null;
  } | null>(null);
  const [drop, setDrop] = useState<{ id: string; label: string; reason: string } | null>(null);
  const [portalPass, setPortalPass] = useState("");
  const [allowManual, setAllowManual] = useState(false);

  async function load() {
    const rec = await getCustomerFn({ data: { id: customerId } });
    setData(rec);
    setForm({
      name: rec.customer.name,
      phone: rec.customer.phone,
      email: rec.customer.email,
      address: rec.customer.address,
      type: rec.customer.type,
      account_number: rec.customer.account_number,
      notes: rec.customer.notes,
      tag_ids: rec.customer.tags.map((t) => t.id),
    });
    try {
      const policy = await getAccountNumberSettingsFn();
      setAllowManual(policy.allow_manual);
    } catch {
      setAllowManual(false);
    }
  }

  useEffect(() => {
    setError(null);
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load customer"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => {
    setEditing(search.action === "edit");
    setProvisionOpen(search.action === "add-service");
    setTab(search.tab || (search.action === "add-service" ? "services" : "overview"));
  }, [customerId, search.tab, search.action]);

  const role = data?.workspace.role || "";
  const canManage = hasPermission(role, "customers.manage");
  const canServices = hasPermission(role, "services.manage");
  const canDeleteSvc = hasPermission(role, "services.delete") || canServices;
  const canReassign = hasPermission(role, "services.reassign") || canServices;
  const canExpiry = hasPermission(role, "services.expiry.update");
  const canGrant = hasPermission(role, "services.grace.grant");
  const canExtend = hasPermission(role, "services.grace.extend");
  const canRevoke = hasPermission(role, "services.grace.revoke");
  const canTraffic = hasPermission(role, "traffic.view") || hasPermission(role, "services.read");
  const canStatements = hasPermission(role, "invoices.read");
  const canRecycle = hasPermission(role, "recycle_bin.view");

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
      if (ok) setNote(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted">Loading customer…</p>
      </div>
    );
  }

  const c = data.customer;
  const leftover = data.services;
  const liveCount = data.services.filter((s) => s.status === "active" || s.status === "grace").length;
  const suspendedCount = data.services.filter((s) => s.status === "suspended").length;
  const derivedStatus = accountState({ customerStatus: c.status, live: liveCount, suspended: suspendedCount });

  function goTab(next: Tab, action?: "add-service" | "edit") {
    setTab(next);
    if (action === "edit") setEditing(true);
    if (action === "add-service") setProvisionOpen(true);
    window.history.replaceState(window.history.state, "", customerRecordPath(customerId, { tab: next === "overview" ? undefined : next, action }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <BackLink />
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="text-sm text-muted">
            <span className="font-mono">{c.account_number || "No account number"}</span>
            {" · "}
            <span className="capitalize">{c.type}</span>
            {c.phone ? ` · ${c.phone}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canTraffic ? (
            <Button
              variant="secondary"
              onClick={() => {
                setTrafficService(undefined);
                setTrafficOpen(true);
              }}
            >
              Realtime traffic
            </Button>
          ) : null}
          {canStatements ? (
            <a href={`/app/statements?customer=${c.id}`} className="inline-flex h-11 items-center rounded-md px-4 text-sm font-medium text-accent hover:underline">
              Statement
            </a>
          ) : null}
          {canManage ? (
            <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close editor" : "Edit"}
            </Button>
          ) : null}
          {canRecycle ? (
            <Link
              to="/app/recycle-bin"
              className="inline-flex h-11 items-center rounded-md border border-border bg-elevated px-4 text-sm font-medium hover:bg-surface"
            >
              Recycle Bin
            </Link>
          ) : null}
          {canManage ? (
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(derivedStatus)}>{accountStateLabel(derivedStatus)}</Badge>
        <span className="text-sm text-muted">{c.service_count} service{c.service_count === 1 ? "" : "s"}</span>
        <span className="text-sm text-muted">Outstanding {kes(c.balance_kes)}</span>
        <TagList tags={c.tags} />
      </div>
      {c.address ? <p className="text-sm text-muted">{c.address}</p> : null}
      {c.notes ? <p className="whitespace-pre-wrap rounded-xl border border-border bg-surface px-4 py-3 text-sm">{c.notes}</p> : null}
      {note ? <p className="text-sm text-accent">{note}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {editing && canManage ? (
        <form
          className="grid gap-3 rounded-xl bg-surface p-5 shadow-card md:grid-cols-2 md:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (form.account_number !== c.account_number) {
                if (!allowManual) throw new Error("Manual editing of account numbers is turned off.");
                if (
                  !window.confirm(
                    `Change account number from ${c.account_number || "(none)"} to ${form.account_number || "(none)"}? Invoices, services, and history stay on this customer.`,
                  )
                ) {
                  return;
                }
              }
              await updateCustomer({
                data: {
                  id: c.id,
                  name: form.name,
                  phone: form.phone,
                  email: form.email,
                  address: form.address,
                  type: form.type,
                  tag_ids: form.tag_ids,
                  account_number: form.account_number,
                  notes: form.notes,
                },
              });
              setEditing(false);
            }, "Customer updated");
          }}
        >
          <h2 className="font-medium md:col-span-2">Edit profile</h2>
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
          <Field label="Account number">
            <Input
              value={form.account_number}
              readOnly={!allowManual}
              onChange={(e) => setForm({ ...form, account_number: e.target.value.toUpperCase() })}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Tags">
              <TagPicker tags={data.tagCatalog} selected={form.tag_ids} onChange={(tag_ids) => setForm({ ...form, tag_ids })} />
            </Field>
          </div>
          <Field label="Portal password">
            <Input
              type="password"
              minLength={8}
              value={portalPass}
              onChange={(e) => setPortalPass(e.target.value)}
              placeholder="Leave blank to keep"
              autoComplete="new-password"
            />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="submit" disabled={busy}>
              Save profile
            </Button>
            {portalPass.length >= 8 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await setCustomerPortalPassword({ data: { customer_id: c.id, password: portalPass } });
                    setPortalPass("");
                  }, "Portal password updated")
                }
              >
                Set portal password
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      <div role="tablist" aria-label="Customer sections" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={cn(
              "h-11 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors",
              tab === t.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={() => goTab(t.id)}
          >
            {t.label}
            {t.id === "services" ? ` (${data.services.length})` : ""}
            {t.id === "billing" ? ` (${data.invoices.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <Overview data={data} />
      ) : null}

      {tab === "services" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">Each line is billed on its own account number. Paying one service does not restore another.</p>
            {canServices ? (
              <Button size="sm" onClick={() => setProvisionOpen((v) => !v)}>
                {provisionOpen ? "Cancel" : "Add service"}
              </Button>
            ) : null}
          </div>
          {provisionOpen && canServices ? (
            <OnboardWizard
              open={provisionOpen}
              onOpenChange={(next) => {
                setProvisionOpen(next);
                if (!next) window.history.replaceState(window.history.state, "", customerRecordPath(customerId, { tab: "services" }));
              }}
              mode="service"
              lockedCustomer={{
                id: c.id,
                name: c.name,
                phone: c.phone,
                email: c.email,
                account_number: c.account_number,
                type: c.type,
                address: c.address,
              }}
              allowChangeCustomer={false}
              onCreated={() => {
                setProvisionOpen(false);
                window.history.replaceState(window.history.state, "", customerRecordPath(customerId, { tab: "services" }));
                void load();
              }}
            />
          ) : null}
          {data.services.length === 0 ? (
            <p className="text-sm text-muted">No services on this customer.</p>
          ) : (
            <ServiceTable
              rows={data.services}
              canServices={canServices}
              canDeleteSvc={canDeleteSvc}
              canReassign={canReassign}
              canExpiry={canExpiry}
              canGrant={canGrant}
              canExtend={canExtend}
              canRevoke={canRevoke}
              canTraffic={canTraffic}
              onStatus={(id, status) => void run(() => setServiceStatus({ data: { id, status } }))}
              onDisconnect={(id, identity) =>
                void run(() => disconnectService({ data: { id } }), `Disconnect queued for ${identity}`)
              }
              onPassword={(id) =>
                void run(async () => {
                  if (!window.confirm("Rotate the PPPoE password? The current password stops working immediately.")) return;
                  const r = await rotateServiceSecret({ data: { id, confirm: true } });
                  setNote(`New PPPoE password for ${r.username}: ${r.password}`);
                })
              }
              onTraffic={(id) => {
                setTrafficService(id);
                setTrafficOpen(true);
              }}
              onExpiry={(s) => {
                setError(null);
                setExpiry(openExpiryForm(s));
              }}
              onGrace={(id, mode) => setGrace({ id, mode })}
              onReassign={(id) => {
                const row = data.services.find((s) => s.id === id);
                if (!row) return;
                setReassign({
                  id: row.id,
                  customer_id: row.customer_id,
                  customer_name: c.name,
                  customer_phone: c.phone,
                  customer_account_number: c.account_number,
                  account_number: row.account_number,
                  package_name: row.package_name,
                  access_method: row.access_method,
                  status: row.status,
                  period_end: row.period_end,
                });
              }}
              onDelete={(s) =>
                setDrop({
                  id: s.id,
                  label: `${s.package_name} · ${accessMethodLabel(s.access_method)}`,
                  reason: "",
                })
              }
            />
          )}
        </div>
      ) : null}

      {tab === "billing" ? <BillingPane data={data} customerId={c.id} canStatements={canStatements} /> : null}
      {tab === "tickets" ? <TicketsPane tickets={data.tickets} /> : null}
      {tab === "messages" ? <MessagesPane messages={data.messages} inbox={data.inbox} /> : null}
      {tab === "activity" ? <ActivityPane rows={data.activity} /> : null}

      <TrafficDrawer
        open={trafficOpen}
        onOpenChange={setTrafficOpen}
        customerId={c.id}
        customerName={c.name}
        serviceId={trafficService}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Move customer to Recycle Bin"
        description="The customer and any remaining services leave live searches. Invoices, payments, and audit history stay. Restore is available in the Recycle Bin."
        className="sm:max-w-xl"
      >
        <DeleteCustomerForm
          leftover={leftover}
          others={data.others}
          busy={busy}
          onCancel={() => setDeleteOpen(false)}
          onReassign={(id, to) =>
            void run(async () => {
              await reassignServiceFn({ data: { id, customer_id: to, confirm: true } });
            }, "Service moved")
          }
          onDelete={async (deleteServices, reason) => {
            setBusy(true);
            setError(null);
            try {
              const out = await deleteCustomerFn({
                data: { id: c.id, delete_services: deleteServices, confirm: true, reason },
              });
              await navigate({ to: "/app/recycle-bin" });
              return out;
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not delete customer");
              setBusy(false);
            }
          }}
        />
      </Dialog>

      <Dialog
        open={Boolean(expiry)}
        onOpenChange={(next) => {
          if (!next && !busy) setExpiry(null);
        }}
        title="Edit expiry date"
        description="Changes access only. Paid-through date, invoices, and customer messages stay as they are."
      >
        {expiry ? (
          <ExpiryEditor
            form={expiry}
            setForm={setExpiry}
            busy={busy}
            error={error}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const out = await setServiceExpiryFn({
                  data: { id: expiry.service.id, date: expiry.date, reason: expiry.reason },
                });
                setExpiry(null);
                setNote(
                  `Expiry date updated for ${out.customer_name}. Status: ${out.status === "grace" ? "Grace Period" : out.status}. No billing or customer message was sent.`,
                );
              });
            }}
            onClose={() => setExpiry(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(grace)}
        onOpenChange={(next) => {
          if (!next) setGrace(null);
        }}
        title={grace?.mode === "grant" ? "Grant Grace Period" : grace?.mode === "extend" ? "Extend Grace Period" : "Revoke Grace Period"}
      >
        {grace ? (
          <GraceForm
            mode={grace.mode}
            busy={busy}
            onCancel={() => setGrace(null)}
            onSubmit={(days, reason) =>
              void run(async () => {
                if (grace.mode === "grant") await grantGraceFn({ data: { service_id: grace.id, days, reason } });
                else if (grace.mode === "extend") await extendGraceFn({ data: { service_id: grace.id, days, reason } });
                else await revokeGraceFn({ data: { service_id: grace.id, reason } });
                setGrace(null);
              }, "Grace period updated")
            }
          />
        ) : null}
      </Dialog>

      <ReassignServiceDialog
        open={Boolean(reassign)}
        onOpenChange={(next) => {
          if (!next) setReassign(null);
        }}
        service={reassign ? reassignInfoFromRow(reassign) : null}
        busy={busy}
        error={error}
        onSubmit={(customerId, reason) =>
          run(async () => {
            await reassignServiceFn({ data: { id: reassign!.id, customer_id: customerId, confirm: true, reason } });
            setReassign(null);
          }, "Service reassigned")
        }
      />

      <Dialog
        open={Boolean(drop)}
        onOpenChange={(next) => {
          if (!next) setDrop(null);
        }}
        title="Move service to Recycle Bin"
        description="The line leaves live searches and network access is revoked. The customer, other services, invoices, and payments stay."
      >
        {drop ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await deleteServiceFn({ data: { id: drop.id, reason: drop.reason, confirm: true } });
                setDrop(null);
              }, "Service moved to the Recycle Bin. Customer kept.");
            }}
          >
            <p className="text-sm">{drop.label}</p>
            <Field label="Reason">
              <Input
                required
                value={drop.reason}
                onChange={(e) => setDrop({ ...drop, reason: e.target.value })}
                placeholder="Why this line is being removed"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={busy || !drop.reason.trim()}>
                Move to Recycle Bin
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDrop(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/app/customers" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-fg">
      <ArrowLeft className="size-4" strokeWidth={1.75} />
      Customers
    </Link>
  );
}

function Overview({ data }: { data: RecordData }) {
  const lastPay = data.payments[0];
  const openTickets = data.tickets.filter((t) => t.status !== "resolved" && t.status !== "closed").length;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Profile</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <Row label="Phone" value={data.customer.phone || "—"} />
          <Row label="Email" value={data.customer.email || "—"} />
          <Row label="Address" value={data.customer.address || "—"} />
          <Row label="Account" value={data.customer.account_number || "—"} mono />
          <Row label="Created" value={formatDate(data.customer.created_at)} />
        </dl>
      </section>
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Snapshot</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <Row label="Outstanding" value={kes(data.customer.balance_kes)} />
          <Row label="Last payment" value={lastPay ? `${kes(lastPay.amount_kes)} · ${formatDate(lastPay.paid_at)}` : "None"} />
          <Row label="Open tickets" value={String(openTickets)} />
          <Row label="Invoices" value={String(data.invoices.length)} />
        </dl>
      </section>
      <div className="lg:col-span-2">
        <PartialPaymentPanel role={data.workspace.role} customerId={data.customer.id} />
      </div>
      <div className="lg:col-span-2">
        <BusinessCreditPanel role={data.workspace.role} customerId={data.customer.id} />
      </div>
      <section className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
        <h2 className="text-sm font-medium">Services</h2>
        {data.services.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No services yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {data.services.slice(0, 5).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link
                  to="/app/services/$serviceId"
                  params={{ serviceId: s.id }}
                  className="min-h-11 font-medium hover:text-accent hover:underline"
                >
                  {s.package_name} · {accessMethodLabel(s.access_method)}
                </Link>
                <span className="flex items-center gap-2">
                  <Badge tone={statusTone(s.status)}>{s.status === "grace" ? "Grace Period" : s.status}</Badge>
                  <span className="text-xs text-muted">{formatDate(effectiveAccessIso(s))}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("text-right", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}

function ServiceTable({
  rows,
  canServices,
  canDeleteSvc,
  canReassign,
  canExpiry,
  canGrant,
  canExtend,
  canRevoke,
  canTraffic,
  onStatus,
  onDisconnect,
  onPassword,
  onTraffic,
  onExpiry,
  onGrace,
  onReassign,
  onDelete,
}: {
  rows: ServiceRow[];
  canServices: boolean;
  canDeleteSvc: boolean;
  canReassign: boolean;
  canExpiry: boolean;
  canGrant: boolean;
  canExtend: boolean;
  canRevoke: boolean;
  canTraffic: boolean;
  onStatus: (id: string, status: ServiceStatus) => void;
  onDisconnect: (id: string, identity: string) => void;
  onPassword: (id: string) => void;
  onTraffic: (id: string) => void;
  onExpiry: (s: ServiceRow) => void;
  onGrace: (id: string, mode: GraceMode) => void;
  onReassign: (id: string) => void;
  onDelete: (s: ServiceRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Service</th>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Identity</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Expiry</th>
            <th className="px-3 py-2 font-medium">Due</th>
            <th className="px-2 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((s) => {
            const activeGrace = Boolean(s.grace_active && s.grace_expires_at);
            const identity = s.username || s.static_ip || "—";
            return (
              <tr key={s.id} className="h-12">
                <td className="px-3 py-1.5">
                  <Link
                    to="/app/services/$serviceId"
                    params={{ serviceId: s.id }}
                    className="inline-flex min-h-11 items-center font-medium hover:text-accent hover:underline"
                  >
                    {s.name || s.package_name}
                  </Link>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{s.account_number || "—"}</td>
                <td className="px-3 py-1.5">{accessMethodLabel(s.access_method)}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{identity}</td>
                <td className="px-3 py-1.5">
                  <Badge tone={statusTone(s.status)}>{s.status === "grace" ? "Grace Period" : s.status}</Badge>
                  {activeGrace && s.grace_expires_at ? (
                    <div className="text-xs text-warn">{remainingLabel(s.grace_expires_at)}</div>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <div>{formatDate(effectiveAccessIso(s))}</div>
                  <div className="text-xs text-subtle">{expirySourceLabel(s.expiry_source, s.grace_active)}</div>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs tabular-nums">{kes(s.outstanding_kes || 0)}</td>
                <td className="px-1 py-1 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Actions for ${s.package_name}`} className="size-11">
                        <MoreHorizontal className="size-4" strokeWidth={1.75} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{accessMethodLabel(s.access_method)}</DropdownMenuLabel>
                      <DropdownMenuItem asChild>
                        <Link to="/app/services/$serviceId" params={{ serviceId: s.id }}>
                          View service
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href={customerRecordPath(s.customer_id, { tab: "billing" })}>Pay / invoices</a>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href={`/app/statements?customer=${s.customer_id}&service=${s.id}`}>View statement</a>
                      </DropdownMenuItem>
                      {canTraffic ? <DropdownMenuItem onSelect={() => onTraffic(s.id)}>Realtime traffic</DropdownMenuItem> : null}
                      <DropdownMenuSeparator />
                      {canExpiry ? <DropdownMenuItem onSelect={() => onExpiry(s)}>Edit expiry date</DropdownMenuItem> : null}
                      {canServices && s.status !== "active" ? (
                        <DropdownMenuItem onSelect={() => onStatus(s.id, "active")}>Restore</DropdownMenuItem>
                      ) : null}
                      {canServices && s.status === "active" ? (
                        <DropdownMenuItem onSelect={() => onStatus(s.id, "suspended")}>Suspend</DropdownMenuItem>
                      ) : null}
                      {canGrant && !activeGrace && s.status !== "terminated" ? (
                        <DropdownMenuItem onSelect={() => onGrace(s.id, "grant")}>Grant Grace Period</DropdownMenuItem>
                      ) : null}
                      {canExtend && activeGrace ? (
                        <DropdownMenuItem onSelect={() => onGrace(s.id, "extend")}>Extend Grace Period</DropdownMenuItem>
                      ) : null}
                      {canRevoke && activeGrace ? (
                        <DropdownMenuItem onSelect={() => onGrace(s.id, "revoke")}>Revoke Grace Period</DropdownMenuItem>
                      ) : null}
                      {canServices ? (
                        <DropdownMenuItem onSelect={() => onDisconnect(s.id, identity)}>Disconnect</DropdownMenuItem>
                      ) : null}
                      {canServices && s.access_method === "pppoe" ? (
                        <DropdownMenuItem onSelect={() => onPassword(s.id)}>New password</DropdownMenuItem>
                      ) : null}
                      {canReassign ? <DropdownMenuItem onSelect={() => onReassign(s.id)}>Reassign</DropdownMenuItem> : null}
                      {canDeleteSvc ? (
                        <DropdownMenuItem danger onSelect={() => onDelete(s)}>
                          Move to Recycle Bin
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BillingPane({
  data,
  customerId,
  canStatements,
}: {
  data: RecordData;
  customerId: string;
  canStatements: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          Outstanding <span className="font-medium">{kes(data.customer.balance_kes)}</span>
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          {canStatements ? (
            <a href={`/app/statements?customer=${customerId}`} className="min-h-11 text-accent hover:underline">
              Open statement
            </a>
          ) : null}
          <a href="/app/billing" className="inline-flex min-h-11 items-center text-accent hover:underline">
            Billing
          </a>
        </div>
      </div>
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <h2 className="px-4 pt-3 text-sm font-medium">Invoices</h2>
        {data.invoices.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No invoices.</p>
        ) : (
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Remaining</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.invoices.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2 font-mono text-xs">{i.number}</td>
                  <td className="px-4 py-2">
                    <div>{i.service_name || "—"}</div>
                    {i.service_account ? <div className="font-mono text-xs text-muted">{i.service_account}</div> : null}
                  </td>
                  <td className="px-4 py-2 font-mono tabular-nums">{kes(i.amount_kes)}</td>
                  <td className="px-4 py-2 font-mono tabular-nums">{kes(i.remaining_kes)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={statusTone(i.status)}>{i.status}</Badge>
                  </td>
                  <td className="px-4 py-2">{formatDate(i.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <h2 className="px-4 pt-3 text-sm font-medium">Payments</h2>
        {data.payments.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No payments.</p>
        ) : (
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Provider</th>
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">{formatDateTime(p.paid_at)}</td>
                  <td className="px-4 py-2 font-mono tabular-nums">{kes(p.amount_kes)}</td>
                  <td className="px-4 py-2 capitalize">{p.provider}</td>
                  <td className="px-4 py-2 font-mono text-xs">{p.reference || "—"}</td>
                  <td className="px-4 py-2">
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function TicketsPane({ tickets }: { tickets: RecordData["tickets"] }) {
  return (
    <div className="space-y-3">
      <Link to="/app/tickets" className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">
        Open tickets
      </Link>
      {tickets.length === 0 ? (
        <p className="text-sm text-muted">No tickets for this customer.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {tickets.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{t.title}</div>
                <div className="text-xs text-muted">
                  {t.category} · {t.priority} · {formatDate(t.created_at)}
                </div>
              </div>
              <Badge tone={statusTone(t.status)}>{t.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessagesPane({
  messages,
  inbox,
}: {
  messages: RecordData["messages"];
  inbox: RecordData["inbox"];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Notifications sent</h2>
        {messages.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No SMS, email, or WhatsApp logs.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {messages.map((m) => (
              <li key={m.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{m.channel}</span>
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </div>
                <p className="text-muted">{m.subject || m.event_code}</p>
                <p className="text-xs text-subtle">{formatDateTime(m.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">In-app inbox</h2>
        {inbox.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No portal messages.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {inbox.map((m) => (
              <li key={m.id} className="text-sm">
                <div className="font-medium">{m.subject}</div>
                <p className="text-muted">{m.body}</p>
                <p className="text-xs text-subtle">{formatDateTime(m.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ActivityPane({ rows }: { rows: RecordData["activity"] }) {
  if (!rows.length) return <p className="text-sm text-muted">No activity recorded for this customer yet.</p>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
      {rows.map((a) => (
        <li key={a.id} className="px-4 py-3 text-sm">
          <div className="font-medium">{a.action}</div>
          {a.details ? <p className="break-all text-xs text-muted">{a.details}</p> : null}
          <p className="text-xs text-subtle">{formatDateTime(a.created_at)}</p>
        </li>
      ))}
    </ul>
  );
}

function GraceForm({
  mode,
  busy,
  onCancel,
  onSubmit,
}: {
  mode: GraceMode;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (days: number, reason: string) => void;
}) {
  const [days, setDays] = useState(3);
  const [reason, setReason] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(days, reason);
      }}
    >
      <p className="text-sm text-muted">
        {mode === "revoke"
          ? "Revoking makes this line eligible for normal suspension. The renewal date does not change."
          : "Grace Period is temporary access only. The paid-through / renewal date stays the same."}
      </p>
      {mode !== "revoke" ? (
        <Field label="Days">
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3, 5, 7].map((d) => (
              <option key={d} value={d}>
                {d} day{d === 1 ? "" : "s"}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Reason (optional)">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {mode === "grant" ? "Grant" : mode === "extend" ? "Extend" : "Revoke"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteCustomerForm({
  leftover,
  others,
  busy,
  onCancel,
  onReassign,
  onDelete,
}: {
  leftover: ServiceRow[];
  others: { id: string; name: string; account_number: string }[];
  busy: boolean;
  onCancel: () => void;
  onReassign: (id: string, to: string) => void;
  onDelete: (deleteServices: boolean, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [deleteServices, setDeleteServices] = useState(false);
  const [dest, setDest] = useState<Record<string, string>>({});
  const defaultDest = others[0]?.id || "";

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onDelete(deleteServices, reason);
      }}
    >
      {leftover.length ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {leftover.length} associated service{leftover.length === 1 ? "" : "s"}
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {leftover.map((s) => (
              <li key={s.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="text-sm">
                  <div className="font-medium">
                    {s.package_name} · {accessMethodLabel(s.access_method)}
                  </div>
                  <div className="text-xs text-muted">
                    {s.username || s.static_ip || "—"} · {s.status}
                  </div>
                </div>
                {others.length ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={dest[s.id] || defaultDest}
                      onChange={(e) => setDest({ ...dest, [s.id]: e.target.value })}
                      aria-label={`Reassign ${s.package_name}`}
                    >
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy || !others.length}
                      onClick={() => onReassign(s.id, dest[s.id] || defaultDest)}
                    >
                      Reassign
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted">No other customer in this ISP to move the line to.</p>
                )}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={deleteServices}
              onChange={(e) => setDeleteServices(e.target.checked)}
            />
            <span>
              Delete this customer and move remaining associated services to the Recycle Bin. RADIUS, PPPoE, static IP,
              MikroTik queues, and access for those lines will be revoked. Invoices and payments are kept.
            </span>
          </label>
        </div>
      ) : (
        <p className="text-sm text-muted">No services remain. The customer will move to the Recycle Bin. Invoices and payments are kept.</p>
      )}
      <Field label="Reason">
        <Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this customer is being removed" />
      </Field>
      {leftover.length && !deleteServices ? (
        <p className="text-sm text-warn">Reassign every line, or tick the box to move remaining services to the Recycle Bin with the customer.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="danger"
          disabled={busy || !reason.trim() || (leftover.length > 0 && !deleteServices)}
        >
          Move to Recycle Bin
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
