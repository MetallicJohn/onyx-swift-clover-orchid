import { useEffect, useMemo, useRef, useState } from "react";
import { TagPicker } from "@/components/isp/tag-picker";
import { CustomerIdSetupForm } from "@/components/isp/customer-id-setup-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { accessMethodLabel, formatDate } from "@/lib/isp/display";
import {
  EMPTY_CUSTOMER,
  EMPTY_SERVICE,
  activationLabel,
  billingPeriodLabel,
  defaultActivation,
  defaultExpiryYmd,
  defaultServiceName,
  displayDraftAccount,
  displayPhone,
  expiryAfterActivationChange,
  expiryHelperText,
  firstError,
  isMigratingOnboard,
  onboardingTypeLabel,
  provisionStatusLabel,
  sanitizeCustomer,
  sanitizeService,
  stripIncompatibleFields,
  validateCustomerDraft,
  validateServiceDraft,
  billingAnchorYmd,
  type ActivationMode,
  type OnboardCustomerDraft,
  type OnboardServiceDraft,
  type OnboardingType,
} from "@/lib/isp/onboard";
import {
  createOnboardFn,
  findOnboardDuplicatesFn,
  loadOnboardCatalogFn,
  searchOnboardCustomersFn,
} from "@/lib/isp/server-onboard";
import type { DuplicateMatch } from "@/lib/isp/onboard";
import { kesPercent, previewPartial, validityLabel } from "@/lib/isp/partial-payment-format";
import type { AccessMethod, PackageRow } from "@/lib/isp/types";
import { cn, kes } from "@/lib/utils";

export type OnboardLockedCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  account_number?: string;
  type?: string;
  address?: string;
};

export type OnboardCreated = {
  customer_id: string;
  service_id: string | null;
  invoice_id: string | null;
  account_number: string;
  customer_account_number?: string;
  username: string | null;
  password: string | null;
  static_ip: string | null;
  status: string | null;
  activation: string | null;
  provision_overall: string | null;
  partial_error: string | null;
};

type Catalog = Awaited<ReturnType<typeof loadOnboardCatalogFn>>;
type CustomerHit = { id: string; name: string; phone: string; email: string; account_number: string; type: string; address: string; service_count: number };
type StepId = "customer" | "plan" | "details" | "review";
type CpeFilter = "all" | "unassigned" | "new" | "online" | "offline";

const METHOD_HELP: Record<AccessMethod, string> = {
  pppoe: "Username and password on the customer router. RADIUS and, if attached, the CPE.",
  static: "A fixed IP from a pool, with Easy Queue on the assigned router.",
  hotspot: "A hotspot login or voucher on this package.",
};

function stepsFor(mode: "customer" | "service", includeService: boolean): { id: StepId; label: string }[] {
  if (mode === "customer" && !includeService) {
    return [
      { id: "customer", label: "Customer" },
      { id: "review", label: "Review" },
    ];
  }
  return [
    { id: "customer", label: "Customer" },
    { id: "plan", label: "Package" },
    { id: "details", label: "Details" },
    { id: "review", label: "Review" },
  ];
}

function ChoiceCard({
  selected,
  title,
  description,
  onClick,
  disabled,
}: {
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-xl border px-4 py-3 text-left transition-colors",
        selected ? "border-accent bg-accent/10" : "border-border bg-bg hover:bg-elevated",
        disabled ? "opacity-50" : "",
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
    </button>
  );
}

function CustomerCard({
  c,
  onChange,
}: {
  c: { name: string; phone?: string; email?: string; account_number?: string };
  onChange?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-bg px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{c.name}</p>
        <p className="mt-0.5 text-xs text-muted">
          {c.account_number || "No ID"}
          {c.phone ? ` · ${displayPhone(c.phone)}` : ""}
          {c.email ? ` · ${c.email}` : ""}
        </p>
      </div>
      {onChange ? (
        <Button type="button" size="sm" variant="ghost" onClick={onChange}>
          Change
        </Button>
      ) : null}
    </div>
  );
}

export function OnboardWizard({
  open,
  onOpenChange,
  mode,
  lockedCustomer,
  allowChangeCustomer = true,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "customer" | "service";
  lockedCustomer?: OnboardLockedCustomer | null;
  allowChangeCustomer?: boolean;
  onCreated: (result: OnboardCreated) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>("customer");
  const [includeService, setIncludeService] = useState(mode === "service");
  const [customerMode, setCustomerMode] = useState<"new" | "existing">(mode === "service" ? "existing" : "new");
  const [customer, setCustomer] = useState<OnboardCustomerDraft>(EMPTY_CUSTOMER);
  const [selected, setSelected] = useState<OnboardLockedCustomer | null>(lockedCustomer ?? null);
  const [service, setService] = useState<OnboardServiceDraft>(EMPTY_SERVICE);
  const [expiryDirty, setExpiryDirty] = useState(false);
  const [nameDirty, setNameDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);
  const [ackDupes, setAckDupes] = useState(false);
  const [pkgQuery, setPkgQuery] = useState("");
  const [cpeFilter, setCpeFilter] = useState<CpeFilter>("unassigned");
  const [cpeQuery, setCpeQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OnboardCreated | null>(null);
  const submitLock = useRef(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCustomer = catalog?.canCreateCustomer ?? mode === "customer";
  const canService = catalog?.canCreateService ?? true;
  const canActivateNow = catalog?.canActivateNow ?? true;
  const canOverrideExpiry = catalog?.canOverrideExpiry ?? true;

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    setResult(null);
    setError(null);
    setStep(lockedCustomer && mode === "service" ? "plan" : "customer");
    setIncludeService(true);
    setCustomerMode(lockedCustomer || mode === "service" ? "existing" : "new");
    setCustomer({
      ...EMPTY_CUSTOMER,
    });
    setSelected(lockedCustomer ?? null);
    setService(EMPTY_SERVICE);
    setExpiryDirty(false);
    setNameDirty(false);
    setQuery("");
    setHits([]);
    setDupes([]);
    setAckDupes(false);
    setPkgQuery("");
    setCpeFilter("unassigned");
    setCpeQuery("");
    loadOnboardCatalogFn()
      .then((res) => {
        setCatalog(res);
        setService((s) => {
          if (s.package_id && res.packages.some((p) => p.id === s.package_id)) return s;
          const first =
            res.packages.find((p) => p.access_method === s.access_method) || res.packages[0];
          if (!first) return s;
          const activation = defaultActivation(first.price_kes);
          return stripIncompatibleFields({
            ...s,
            access_method: first.access_method,
            package_id: first.id,
            name: defaultServiceName(first.name, s.name, false),
            activation,
            expiry_ymd: s.expiry_ymd || defaultExpiryYmd(first, activation),
            pool_id: s.pool_id || res.pools[0]?.id || "",
          });
        });
        if (lockedCustomer && mode === "service") setStep("plan");
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, lockedCustomer?.id]);

  const packages = catalog?.packages ?? [];
  const matchingPackages = useMemo(() => {
    const q = pkgQuery.trim().toLowerCase();
    return packages.filter((p) => p.access_method === service.access_method && (!q || p.name.toLowerCase().includes(q)));
  }, [packages, pkgQuery, service.access_method]);
  const selectedPkg = packages.find((p) => p.id === service.package_id) || null;
  const devices = catalog?.devices ?? [];
  const filteredDevices = useMemo(() => {
    const q = cpeQuery.trim().toLowerCase();
    return devices.filter((d) => {
      if (cpeFilter === "unassigned" && d.assigned) return false;
      if (cpeFilter === "new" && !d.newly_discovered) return false;
      if (cpeFilter === "online" && d.status !== "online") return false;
      if (cpeFilter === "offline" && d.status === "online") return false;
      if (q && !`${d.serial} ${d.product_class} ${d.manufacturer}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [devices, cpeFilter, cpeQuery]);

  const steps = stepsFor(mode, includeService && canService);
  const stepIndex = Math.max(0, steps.findIndex((s) => s.id === step));

  function patchService(patch: Partial<OnboardServiceDraft>) {
    setService((prev) => stripIncompatibleFields({ ...prev, ...patch }));
  }

  function chooseMethod(method: AccessMethod) {
    const first = packages.find((p) => p.access_method === method);
    const migrating = isMigratingOnboard(service.onboarding_type);
    const activation = migrating ? "active" : first ? defaultActivation(first.price_kes) : "after_payment";
    setService((prev) =>
      stripIncompatibleFields({
        ...prev,
        access_method: method,
        package_id: first?.id || "",
        name: defaultServiceName(first?.name || "", prev.name, nameDirty),
        activation,
        expiry_ymd: expiryDirty || migrating
          ? prev.expiry_ymd
          : first
            ? defaultExpiryYmd(first, activation)
            : "",
        username: "",
        auto_username: true,
        static_ip: "",
        pool_id: catalog?.pools[0]?.id || "",
      }),
    );
  }

  function choosePackage(pkg: PackageRow) {
    const migrating = isMigratingOnboard(service.onboarding_type);
    const activation = migrating ? "active" : defaultActivation(pkg.price_kes);
    setService((prev) =>
      stripIncompatibleFields({
        ...prev,
        package_id: pkg.id,
        access_method: pkg.access_method,
        name: defaultServiceName(pkg.name, prev.name, nameDirty),
        activation,
        expiry_ymd: expiryDirty || migrating ? prev.expiry_ymd : defaultExpiryYmd(pkg, activation),
      }),
    );
  }

  function chooseOnboarding(type: OnboardingType) {
    const migrating = isMigratingOnboard(type);
    setService((prev) => {
      const pkg = packages.find((p) => p.id === prev.package_id) || selectedPkg;
      const activation = migrating ? "active" : defaultActivation(pkg?.price_kes || 0);
      return stripIncompatibleFields({
        ...prev,
        onboarding_type: type,
        send_onboarding_notification: migrating ? false : true,
        activation,
        expiry_ymd: migrating
          ? expiryDirty
            ? prev.expiry_ymd
            : ""
          : expiryDirty
            ? prev.expiry_ymd
            : pkg
              ? defaultExpiryYmd(pkg, activation)
              : prev.expiry_ymd,
      });
    });
    if (migrating) setExpiryDirty(false);
  }

  function chooseActivation(next: ActivationMode) {
    if (next === "active" && !canActivateNow && !isMigratingOnboard(service.onboarding_type)) return;
    if (next === "after_partial" && !catalog?.partial?.can_offer) return;
    setService((prev) => {
      const pkg = packages.find((p) => p.id === prev.package_id) || selectedPkg;
      return stripIncompatibleFields({
        ...prev,
        activation: next,
        expiry_ymd: expiryAfterActivationChange({
          currentYmd: prev.expiry_ymd,
          previousActivation: prev.activation,
          nextActivation: next,
          pkg,
          dirty: expiryDirty,
          onboardingType: prev.onboarding_type,
        }),
      });
    });
  }

  function onSearch(value: string) {
    setQuery(value);
    if (searchRef.current) clearTimeout(searchRef.current);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    searchRef.current = setTimeout(() => {
      setSearching(true);
      searchOnboardCustomersFn({ data: { q: value } })
        .then((res) => setHits(res.customers))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
  }

  async function goNext() {
    setError(null);
    if (step === "customer") {
      if (mode === "customer" && customerMode === "new") {
        const errs = validateCustomerDraft(sanitizeCustomer(customer));
        const msg = firstError(errs);
        if (msg) {
          setError(msg);
          return;
        }
        try {
          const found = await findOnboardDuplicatesFn({
            data: { name: customer.name, phone: customer.phone, email: customer.email },
          });
          setDupes(found.matches);
          if (found.matches.some((m) => m.blocking)) {
            setError("A customer with this phone already exists. Open the existing account instead of creating another.");
            return;
          }
          if (found.matches.length && !ackDupes) {
            setError("Possible duplicate. Open the existing customer, or continue to create a new one.");
            return;
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not check for duplicates");
          return;
        }
      } else if (!selected?.id) {
        setError("Search and confirm the customer before continuing");
        return;
      }
      if (includeService && canService) {
        if (!service.access_method || !packages.some((p) => p.access_method === service.access_method)) {
          const first = packages[0];
          if (first) chooseMethod(first.access_method);
        }
        setStep("plan");
      } else {
        setStep("review");
      }
      return;
    }
    if (step === "plan") {
      if (!selectedPkg) {
        setError("Choose a package for this service type");
        return;
      }
      if (!service.expiry_ymd && selectedPkg && !isMigratingOnboard(service.onboarding_type)) {
        patchService({ expiry_ymd: defaultExpiryYmd(selectedPkg, service.activation) });
      }
      if (!service.activation) patchService({ activation: defaultActivation(selectedPkg.price_kes) });
      setStep("details");
      return;
    }
    if (step === "details") {
      if (service.access_method === "static" && !service.static_ip && !(catalog?.pools.length)) {
        setError("No IP pool on this network. Enter a static IP, or add a pool before creating this line.");
        return;
      }
      const errs = validateServiceDraft(sanitizeService(service), selectedPkg);
      const msg = firstError(errs);
      if (msg) {
        setError(msg);
        return;
      }
      setStep("review");
    }
  }

  function goBack() {
    setError(null);
    if (step === "review") {
      setStep(includeService && canService ? "details" : "customer");
      return;
    }
    if (step === "details") setStep("plan");
    if (step === "plan") setStep("customer");
  }

  async function submit() {
    if (busy || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await createOnboardFn({
        data: {
          customer_mode: mode === "customer" && customerMode === "new" ? "new" : "existing",
          customer_id: selected?.id,
          customer: customerMode === "new" ? sanitizeCustomer(customer) : undefined,
          acknowledge_duplicates: ackDupes,
          include_service: includeService && canService,
          service: includeService && canService ? sanitizeService(service) : undefined,
        },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }

  const title = result
    ? result.partial_error
      ? result.service_id
        ? "Saved with a warning"
        : mode === "customer"
          ? "Customer saved"
          : "Could not create service"
      : mode === "customer"
        ? includeService
          ? "Customer and service created"
          : "Customer created"
        : "Service created"
    : mode === "customer"
      ? "Add customer"
      : "Add service";

  const confirmedCustomer =
    customerMode === "existing" && selected
      ? {
          name: selected.name,
          phone: selected.phone,
          email: selected.email,
          account_number: displayDraftAccount(selected.account_number, "existing"),
        }
      : customerMode === "new"
        ? {
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            account_number: displayDraftAccount(customer.account_number, "new"),
          }
        : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        result
          ? undefined
          : mode === "customer"
            ? "Customer details, then the first service if you want it now."
            : "Confirm the customer, then the service type and package."
      }
      className="sm:max-w-2xl"
    >
      {loadError ? (
        <p className="text-sm text-danger">{loadError}</p>
      ) : !catalog && !result ? (
        <p className="text-sm text-muted">Loading packages and devices…</p>
      ) : result ? (
        <SuccessPanel result={result} service={service} pkg={selectedPkg} onContinue={() => onCreated(result)} />
      ) : catalog && !catalog.customer_id.configured && !lockedCustomer && mode !== "service" && customerMode === "new" ? (
        <CustomerIdSetupForm
          onResolved={() => {
            loadOnboardCatalogFn().then(setCatalog).catch(() => undefined);
          }}
          onCancel={() => onOpenChange(false)}
        />
      ) : (
        <div className="grid gap-4">
          <ol className="flex flex-wrap gap-2" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm",
                    i === stepIndex ? "bg-accent text-accent-fg" : i < stepIndex ? "bg-accent/15 text-fg" : "bg-elevated text-muted",
                  )}
                  onClick={() => {
                    if (i < stepIndex) setStep(s.id);
                  }}
                >
                  <span className="font-mono text-xs">{i + 1}</span>
                  {s.label}
                </button>
              </li>
            ))}
          </ol>

          {step === "customer" ? (
            <div className="grid gap-4">
              {mode === "service" || customerMode === "existing" ? (
                selected && (lockedCustomer || !allowChangeCustomer) ? (
                  <CustomerCard c={selected} />
                ) : selected ? (
                  <CustomerCard c={selected} onChange={() => setSelected(null)} />
                ) : (
                  <div className="grid gap-2">
                    <Field label="Find customer">
                      <Input
                        value={query}
                        onChange={(e) => onSearch(e.target.value)}
                        placeholder="Name, phone, ID, or email"
                        autoFocus
                      />
                    </Field>
                    {searching ? <p className="text-xs text-muted">Searching…</p> : null}
                    {hits.length ? (
                      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                        {hits.map((h) => (
                          <li key={h.id}>
                            <button
                              type="button"
                              className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-elevated"
                              onClick={() => {
                                setSelected(h);
                                setCustomerMode("existing");
                              }}
                            >
                              <span className="min-w-0">
                                <span className="block text-sm font-medium">{h.name}</span>
                                <span className="block text-xs text-muted">
                                  {h.account_number || "No ID"} · {displayPhone(h.phone)}
                                  {h.email ? ` · ${h.email}` : ""}
                                </span>
                              </span>
                              <span className="text-xs text-subtle">{h.service_count} line{h.service_count === 1 ? "" : "s"}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : query.trim().length >= 2 && !searching ? (
                      <p className="text-sm text-muted">No matching customer.</p>
                    ) : (
                      <p className="text-sm text-muted">Search by name, phone, ID, or email.</p>
                    )}
                    {mode === "customer" && canCustomer ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setCustomerMode("new");
                          setSelected(null);
                        }}
                      >
                        New customer instead
                      </Button>
                    ) : null}
                  </div>
                )
              ) : null}

              {mode === "customer" && customerMode === "new" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <Input required value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} autoFocus />
                  </Field>
                  <Field label="Type">
                    <Select value={customer.type} onChange={(e) => setCustomer({ ...customer, type: e.target.value })}>
                      <option value="individual">Individual</option>
                      <option value="business">Business</option>
                    </Select>
                  </Field>
                  <Field label="Phone">
                    <Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} inputMode="tel" />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
                  </Field>
                  <Field label="Address / location">
                    <Input value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
                  </Field>
                  <p className="text-xs text-muted sm:col-span-2">
                    ID {catalog?.customer_id.next_preview || "1"} is assigned when you save.
                  </p>
                  <div className="sm:col-span-2">
                    <Field label="Tags">
                      <TagPicker tags={catalog?.tags ?? []} selected={customer.tag_ids} onChange={(tag_ids) => setCustomer({ ...customer, tag_ids })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Notes">
                      <Textarea rows={2} value={customer.notes} onChange={(e) => setCustomer({ ...customer, notes: e.target.value })} />
                    </Field>
                  </div>
                </div>
              ) : null}

              {dupes.length ? (
                <div className="space-y-2 rounded-xl border border-warn/40 bg-warn/10 p-3">
                  <p className="text-sm font-medium">Possible existing customer</p>
                  {dupes.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between rounded-lg bg-bg px-3 text-left text-sm"
                      onClick={() => {
                        setSelected({ id: d.id, name: d.name, phone: d.phone, email: d.email, account_number: d.account_number });
                        setCustomerMode("existing");
                        setDupes([]);
                        setError(null);
                      }}
                    >
                      <span>
                        {d.name} · {displayPhone(d.phone)}
                        <span className="ml-2 text-xs text-muted">{d.reason === "phone" ? "Same phone" : d.reason === "email" ? "Same email" : "Same name"}</span>
                      </span>
                      <span className="text-accent">Open</span>
                    </button>
                  ))}
                  {!dupes.some((d) => d.blocking) ? (
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" checked={ackDupes} onChange={(e) => setAckDupes(e.target.checked)} />
                      Create a new customer anyway
                    </label>
                  ) : null}
                </div>
              ) : null}

              {mode === "customer" && canService ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard
                    selected={!includeService}
                    title="Customer only"
                    description="Save the account. Add a service later."
                    onClick={() => setIncludeService(false)}
                  />
                  <ChoiceCard
                    selected={includeService}
                    title="Customer and first service"
                    description="Continue to package, CPE, expiry, and activation."
                    onClick={() => setIncludeService(true)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "plan" ? (
            <div className="grid gap-4">
              {confirmedCustomer ? <CustomerCard c={confirmedCustomer} onChange={allowChangeCustomer ? () => setStep("customer") : undefined} /> : null}
              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted">Service type</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["pppoe", "static", "hotspot"] as AccessMethod[]).map((m) => (
                    <ChoiceCard
                      key={m}
                      selected={service.access_method === m}
                      title={accessMethodLabel(m)}
                      description={METHOD_HELP[m]}
                      onClick={() => chooseMethod(m)}
                      disabled={!packages.some((p) => p.access_method === m)}
                    />
                  ))}
                </div>
              </div>
              <Field label="Package">
                <Input value={pkgQuery} onChange={(e) => setPkgQuery(e.target.value)} placeholder="Search packages" />
              </Field>
              {matchingPackages.length === 0 ? (
                <p className="text-sm text-muted">No active {accessMethodLabel(service.access_method)} packages on this network.</p>
              ) : (
                <ul className="grid max-h-64 gap-2 overflow-y-auto">
                  {matchingPackages.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => choosePackage(p)}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left",
                          service.package_id === p.id ? "border-accent bg-accent/10" : "border-border bg-bg hover:bg-elevated",
                        )}
                      >
                        <span>
                          <span className="block text-sm font-medium">{p.name}</span>
                          <span className="block text-xs text-muted">
                            {p.download_mbps}/{p.upload_mbps} Mbps · {billingPeriodLabel(p.billing_interval, p.validity_hours)}
                          </span>
                        </span>
                        <span className="font-mono text-sm tabular-nums">{kes(p.price_kes)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {step === "details" && selectedPkg ? (
            <div className="grid gap-4">
              <p className="text-sm text-muted">
                {accessMethodLabel(selectedPkg.access_method)} · {selectedPkg.name} · {kes(selectedPkg.price_kes)} /{" "}
                {billingPeriodLabel(selectedPkg.billing_interval, selectedPkg.validity_hours)}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Service name">
                  <Input
                    value={service.name}
                    onChange={(e) => {
                      setNameDirty(true);
                      patchService({ name: e.target.value });
                    }}
                    placeholder={selectedPkg.name}
                  />
                </Field>
                <Field label="Service Account Number">
                  <Input value="Assigned on save" readOnly className="text-muted" />
                </Field>
              </div>
              {service.access_method === "pppoe" ? (
                <div className="grid gap-3">
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={service.auto_username}
                      onChange={(e) => patchService({ auto_username: e.target.checked, username: e.target.checked ? "" : service.username })}
                    />
                    Auto-generate PPPoE credentials
                  </label>
                  {!service.auto_username ? (
                    <Field label="PPPoE username">
                      <Input value={service.username} onChange={(e) => patchService({ username: e.target.value })} />
                    </Field>
                  ) : (
                    <p className="text-xs text-muted">A unique username and password are generated on save. The password is shown once.</p>
                  )}
                </div>
              ) : null}
              {service.access_method === "static" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(catalog?.pools.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted sm:col-span-2">
                      No IP pool on this network. Enter the address below, or add a pool from Routers before auto-assigning.
                    </p>
                  ) : null}
                  <Field label="IP pool">
                    <Select value={service.pool_id} onChange={(e) => patchService({ pool_id: e.target.value })}>
                      <option value="">{(catalog?.pools.length ?? 0) ? "First available pool" : "No pool configured"}</option>
                      {(catalog?.pools ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.cidr}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Static IP">
                    <Input
                      value={service.static_ip}
                      onChange={(e) => patchService({ static_ip: e.target.value })}
                      placeholder={(catalog?.pools.length ?? 0) ? "Blank = next free address" : "Required without a pool"}
                    />
                  </Field>
                  {(catalog?.routers.length ?? 0) > 0 ? (
                    <Field label="Router / AP">
                      <Select value={service.router_id} onChange={(e) => patchService({ router_id: e.target.value })}>
                        <option value="">Auto</option>
                        {catalog?.routers.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                  <Field label="MAC (optional)">
                    <Input value={service.mac_address} onChange={(e) => patchService({ mac_address: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" />
                  </Field>
                </div>
              ) : null}
              {service.access_method === "hotspot" ? (
                <div className="grid gap-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ChoiceCard
                      selected={service.hotspot_mode === "account"}
                      title="Account"
                      description="A reusable hotspot username on this customer."
                      onClick={() => patchService({ hotspot_mode: "account" })}
                    />
                    <ChoiceCard
                      selected={service.hotspot_mode === "voucher"}
                      title="Voucher"
                      description="Issue a one-time hotspot code."
                      onClick={() => patchService({ hotspot_mode: "voucher" })}
                    />
                  </div>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={service.auto_username}
                      onChange={(e) => patchService({ auto_username: e.target.checked, username: e.target.checked ? "" : service.username })}
                    />
                    Auto-generate username
                  </label>
                  {!service.auto_username ? (
                    <Field label="Hotspot username">
                      <Input value={service.username} onChange={(e) => patchService({ username: e.target.value })} />
                    </Field>
                  ) : null}
                </div>
              ) : null}

              {service.access_method !== "hotspot" ? (
                <div className="grid gap-2">
                  <p className="text-xs font-medium tracking-wide text-muted">CPE / ONU (optional)</p>
                  <div className="flex flex-wrap gap-2">
                    {(["unassigned", "new", "online", "offline", "all"] as CpeFilter[]).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={cn(
                          "h-9 rounded-full px-3 text-xs font-medium",
                          cpeFilter === f ? "bg-accent text-accent-fg" : "bg-elevated text-muted",
                        )}
                        onClick={() => setCpeFilter(f)}
                      >
                        {f === "new" ? "Newly discovered" : f[0].toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                  <Input value={cpeQuery} onChange={(e) => setCpeQuery(e.target.value)} placeholder="Serial, model, vendor" />
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-border">
                    <button
                      type="button"
                      className={cn("flex min-h-11 w-full px-3 text-left text-sm", !service.cpe_id ? "bg-accent/10" : "hover:bg-elevated")}
                      onClick={() => patchService({ cpe_id: "" })}
                    >
                      Skip — assign later
                    </button>
                    {filteredDevices.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        disabled={d.assigned && d.id !== service.cpe_id}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between gap-2 border-t border-border px-3 text-left text-sm disabled:opacity-50",
                          service.cpe_id === d.id ? "bg-accent/10" : "hover:bg-elevated",
                        )}
                        onClick={() => patchService({ cpe_id: d.id })}
                      >
                        <span>
                          <span className="font-mono text-xs">{d.serial}</span>
                          <span className="ml-2 text-muted">
                            {d.product_class || "CPE"}
                            {d.manufacturer ? ` · ${d.manufacturer}` : ""}
                          </span>
                        </span>
                        <span className="text-xs text-subtle">
                          {d.assigned ? "Assigned" : d.status}
                          {d.newly_discovered && !d.assigned ? " · new" : ""}
                        </span>
                      </button>
                    ))}
                    {filteredDevices.length === 0 ? <p className="px-3 py-2 text-xs text-muted">No devices match.</p> : null}
                  </div>
                  <p className="text-xs text-muted">Selecting a device does not mean it is provisioned. Offline units can still be attached. WAN and Wi-Fi from this service are written on the next Inform.</p>
                </div>
              ) : null}

              {service.access_method !== "hotspot" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Wi-Fi name (SSID)">
                    <Input
                      value={service.wifi_ssid || ""}
                      onChange={(e) => patchService({ wifi_ssid: e.target.value })}
                      placeholder="Leave blank to generate"
                      maxLength={32}
                    />
                  </Field>
                  <Field label="Wi-Fi password">
                    <Input
                      type="password"
                      value={service.wifi_password || ""}
                      onChange={(e) => patchService({ wifi_password: e.target.value })}
                      placeholder="Leave blank to generate"
                      autoComplete="new-password"
                    />
                  </Field>
                  <p className="text-xs text-muted sm:col-span-2">
                    Written onto the ONU on Inform after this service is assigned. Leave blank to generate a name from the customer and a WPA2 password.
                  </p>
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted">Subscription and billing setup</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <ChoiceCard
                    selected={service.onboarding_type === "new"}
                    title="New customer"
                    description="Billing starts from activation or payment, as today."
                    onClick={() => chooseOnboarding("new")}
                  />
                  <ChoiceCard
                    selected={service.onboarding_type === "continuing"}
                    title="Continuing client / migration"
                    description="Keep the existing expiry. First renewal uses that date, not today."
                    onClick={() => chooseOnboarding("continuing")}
                  />
                  <ChoiceCard
                    selected={service.onboarding_type === "reactivation"}
                    title="Reactivation"
                    description="Bring a previous line back using the expiry they already have."
                    onClick={() => chooseOnboarding("reactivation")}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Subscription start date">
                  <Input
                    type="date"
                    lang="en-GB"
                    value={service.subscription_start_ymd}
                    onChange={(e) => patchService({ subscription_start_ymd: e.target.value })}
                  />
                </Field>
                <Field label={isMigratingOnboard(service.onboarding_type) ? "Existing subscription expiry" : "Expiry date"}>
                  <Input
                    type="date"
                    lang="en-GB"
                    value={service.expiry_ymd}
                    disabled={!canOverrideExpiry && !isMigratingOnboard(service.onboarding_type)}
                    required={isMigratingOnboard(service.onboarding_type)}
                    onChange={(e) => {
                      setExpiryDirty(true);
                      patchService({ expiry_ymd: e.target.value });
                    }}
                  />
                </Field>
              </div>
              <p className="text-sm text-fg">
                Selected expiry: {service.expiry_ymd ? formatDate(service.expiry_ymd) : "Choose a date"}
              </p>
              <p className="text-xs text-muted">{expiryHelperText(service.activation, service.onboarding_type)}</p>
              {isMigratingOnboard(service.onboarding_type) ? (
                <p className="text-sm">
                  First renewal:{" "}
                  <span className="font-medium">
                    {service.expiry_ymd ? formatDate(billingAnchorYmd(service.expiry_ymd) || service.expiry_ymd) : "Same as the expiry date"}
                  </span>
                </p>
              ) : null}
              {!canOverrideExpiry && !isMigratingOnboard(service.onboarding_type) ? (
                <p className="text-xs text-muted">Expiry is set from the activation mode. Ask an owner to override it.</p>
              ) : null}

              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={service.send_onboarding_notification}
                  onChange={(e) => patchService({ send_onboarding_notification: e.target.checked })}
                />
                Send onboarding notification
              </label>
              <p className="text-xs text-muted">
                {isMigratingOnboard(service.onboarding_type)
                  ? "Off by default for migration. Invoice, renewal, and expiry SMS still follow network settings."
                  : "Welcome and service-created SMS. Billing SMS still follow network settings."}
              </p>

              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted">Activation</p>
                <div className={cn("grid gap-2", catalog?.partial?.can_offer ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                  <ChoiceCard
                    selected={service.activation === "after_payment"}
                    title="Activate after full payment"
                    description="Default expiry is today. Access starts only after the invoice is paid in full."
                    onClick={() => chooseActivation("after_payment")}
                  />
                  {catalog?.partial?.can_offer ? (
                    <ChoiceCard
                      selected={service.activation === "after_partial"}
                      title="Activate after qualifying partial payment"
                      description={partialCardDescription(selectedPkg, catalog.partial.min_pct)}
                      onClick={() => chooseActivation("after_partial")}
                    />
                  ) : null}
                  <ChoiceCard
                    selected={service.activation === "active"}
                    title="Start service as Active"
                    description={
                      isMigratingOnboard(service.onboarding_type)
                        ? "Already paid through the selected expiry. Access starts now without a new invoice."
                        : canActivateNow
                          ? "Default expiry is 30 days from today, or the package validity. Access starts now."
                          : "Only authorised staff can start a paid service as Active."
                    }
                    onClick={() => chooseActivation("active")}
                    disabled={!canActivateNow && !isMigratingOnboard(service.onboarding_type)}
                  />
                </div>
                {service.activation === "after_partial" && selectedPkg ? (
                  <PartialPreviewCard pkg={selectedPkg} minPct={catalog?.partial.min_pct ?? 50} />
                ) : null}
              </div>
              <Field label="Service notes">
                <Textarea rows={2} value={service.notes} onChange={(e) => patchService({ notes: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {step === "review" ? (
            <div className="grid gap-3">
              <ReviewBlock title="Customer" onEdit={() => setStep("customer")}>
                <Row label="Name" value={confirmedCustomer?.name || "—"} />
                <Row label="Phone" value={confirmedCustomer?.phone ? displayPhone(confirmedCustomer.phone) : "—"} />
                <Row label="Email" value={confirmedCustomer?.email || "—"} />
                <Row label="ID" value={confirmedCustomer?.account_number || (customerMode === "new" ? "Assigned on save" : "Kept")} />
              </ReviewBlock>
              {includeService && canService && selectedPkg ? (
                <ReviewBlock title="Service" onEdit={() => setStep("plan")}>
                  <Row label="Name" value={service.name || selectedPkg.name} />
                  <Row label="Service Account Number" value="New unique number on save" />
                  <Row label="Type" value={accessMethodLabel(service.access_method)} />
                  <Row label="Package" value={selectedPkg.name} />
                  <Row label="Price" value={`${kes(selectedPkg.price_kes)} · ${billingPeriodLabel(selectedPkg.billing_interval, selectedPkg.validity_hours)}`} />
                  {service.access_method === "pppoe" ? (
                    <Row label="PPPoE" value={service.auto_username ? "Auto-generated credentials" : service.username} />
                  ) : null}
                  {service.access_method === "static" ? (
                    <Row
                      label="Static IP"
                      value={
                        service.static_ip ||
                        `Auto from ${catalog?.pools.find((p) => p.id === service.pool_id)?.name || "pool"}`
                      }
                    />
                  ) : null}
                  {service.access_method === "hotspot" ? (
                    <Row label="Hotspot" value={service.hotspot_mode === "voucher" ? "Voucher code" : service.auto_username ? "Auto username" : service.username} />
                  ) : null}
                  {service.cpe_id ? (
                    <Row label="CPE" value={devices.find((d) => d.id === service.cpe_id)?.serial || service.cpe_id} />
                  ) : service.access_method !== "hotspot" ? (
                    <Row label="CPE" value="Not attached" />
                  ) : null}
                  {service.access_method !== "hotspot" ? (
                    <Row label="Wi-Fi" value={service.wifi_ssid || "Generated on save"} />
                  ) : null}
                  <Row label="Expiry" value={service.expiry_ymd ? formatDate(service.expiry_ymd) : "Package default"} />
                  {isMigratingOnboard(service.onboarding_type) ? (
                    <Row
                      label="First renewal"
                      value={service.expiry_ymd ? formatDate(billingAnchorYmd(service.expiry_ymd) || service.expiry_ymd) : "—"}
                    />
                  ) : null}
                  <Row label="Onboarding" value={onboardingTypeLabel(service.onboarding_type || "new")} />
                  <Row label="Onboarding SMS" value={service.send_onboarding_notification ? "Yes" : "No"} />
                  <Row label="Activation" value={activationLabel(service.activation)} />
                </ReviewBlock>
              ) : (
                <p className="text-sm text-muted">No service will be created. You can add one from the customer profile.</p>
              )}
            </div>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            {step !== "customer" ? (
              <Button type="button" variant="ghost" onClick={goBack} disabled={busy}>
                Back
              </Button>
            ) : null}
            {step !== "review" ? (
              <Button type="button" onClick={() => void goNext()} disabled={busy}>
                Continue
              </Button>
            ) : (
              <Button type="button" onClick={() => void submit()} disabled={busy}>
                {busy ? "Saving…" : includeService && canService ? (mode === "customer" ? "Create customer and service" : "Create service") : "Create customer"}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function ReviewBlock({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <dl className="grid gap-1.5">{children}</dl>
    </div>
  );
}

function SuccessPanel({
  result,
  service,
  pkg,
  onContinue,
}: {
  result: OnboardCreated;
  service: OnboardServiceDraft;
  pkg: PackageRow | null;
  onContinue: () => void;
}) {
  return (
    <div className="grid gap-4">
      {result.partial_error ? <p className="text-sm text-warn">{result.partial_error}</p> : null}
      <dl className="grid gap-2 text-sm">
        <Row label="ID" value={result.customer_account_number || (!result.service_id ? result.account_number : "") || "—"} />
        {result.service_id ? <Row label="Service Account Number" value={result.account_number || "—"} /> : null}
        {result.service_id && pkg ? <Row label="Package" value={service.name || pkg.name} /> : null}
        {result.status ? (
          <Row
            label="Status"
            value={
              result.activation === "after_payment" || result.activation === "after_partial"
                ? "Awaiting payment"
                : result.status === "active"
                  ? `Active until ${service.expiry_ymd ? formatDate(service.expiry_ymd) : "the billed period"}`
                  : result.status
            }
          />
        ) : null}
        {result.username ? <Row label="Username" value={result.username} /> : null}
        {result.password ? <Row label="Password" value={result.password} /> : null}
        {result.static_ip ? <Row label="Static IP" value={result.static_ip} /> : null}
        {result.provision_overall ? (
          <Row label="Provisioning" value={provisionStatusLabel(result.provision_overall)} />
        ) : null}
      </dl>
      {result.password ? (
        <p className="text-xs text-muted">Copy the password now. It is not shown again.</p>
      ) : null}
      {service.cpe_id && result.provision_overall && result.provision_overall !== "verified" ? (
        <p className="text-xs text-muted">The CPE was attached. Provisioning is {provisionStatusLabel(result.provision_overall).toLowerCase()} — not yet verified.</p>
      ) : null}
      <Button type="button" onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}

function packagePeriodMs(pkg: PackageRow) {
  if (pkg.validity_hours > 0) return pkg.validity_hours * 3_600_000;
  if (pkg.billing_interval === "daily") return 86_400_000;
  if (pkg.billing_interval === "weekly") return 7 * 86_400_000;
  if (pkg.billing_interval === "yearly") return 365 * 86_400_000;
  return 30 * 86_400_000;
}

function partialCardDescription(pkg: PackageRow | null | undefined, minPct: number) {
  if (!pkg) return "Access starts after a qualifying percentage of the package price is paid.";
  const min = kesPercent(pkg.price_kes, minPct);
  return `Minimum ${minPct}% (${kes(min)}). Access starts after that payment, with pro-rata days.`;
}

function PartialPreviewCard({ pkg, minPct }: { pkg: PackageRow; minPct: number }) {
  const hourly = pkg.validity_hours > 0;
  const preview = previewPartial({
    fullKes: pkg.price_kes,
    thisKes: kesPercent(pkg.price_kes, minPct),
    minPct,
    periodMs: packagePeriodMs(pkg),
    hourly,
  });
  return (
    <div className="mt-3 rounded-lg border border-border bg-elevated/50 px-3 py-3 text-sm">
      <p className="font-medium">Qualifying partial payment</p>
      <dl className="mt-2 grid gap-1">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Package price</dt>
          <dd>{kes(pkg.price_kes)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Required minimum</dt>
          <dd>
            {minPct}% · {kes(preview.min_kes)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Package validity</dt>
          <dd>{billingPeriodLabel(pkg.billing_interval, pkg.validity_hours)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Minimum payment validity</dt>
          <dd>{validityLabel(preview.grant_ms, hourly)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">
        Paying less than {kes(preview.min_kes)} will be posted but will not activate this service. Full payment grants the
        full package period.
      </p>
    </div>
  );
}



