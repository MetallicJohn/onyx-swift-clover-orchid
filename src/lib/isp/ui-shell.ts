export type ToastKind = "success" | "error" | "warning" | "info";

export type ToastInput = {
  kind: ToastKind;
  title: string;
  description?: string;
};

export type ToastItem = ToastInput & { id: string };

export function toastIdentity(toast: ToastInput) {
  return `${toast.kind}:${toast.title}:${toast.description || ""}`;
}

/** Keep one copy of the same message and cap the stack. */
export function pushToast(list: ToastItem[], toast: ToastInput, id: string, limit = 4): ToastItem[] {
  const key = toastIdentity(toast);
  const without = list.filter((item) => toastIdentity(item) !== key);
  return [...without, { ...toast, id }].slice(-limit);
}

export type ConfirmVariant = "default" | "danger" | "warning";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingLabel?: string;
  variant?: ConfirmVariant;
  /** When set, the user must type this phrase before the action runs. */
  confirmPhrase?: string;
  /** Runs while the dialog stays open. Throw to keep the dialog open. */
  action?: () => Promise<void>;
};

export type ConfirmPhase = "idle" | "loading" | "error";

export function confirmLabels(options: ConfirmOptions) {
  const variant = options.variant || (options.title.toLowerCase().includes("delete") ? "danger" : "default");
  return {
    title: options.title,
    description: options.description || "",
    confirmLabel: options.confirmLabel || (variant === "danger" ? "Confirm" : "Continue"),
    cancelLabel: options.cancelLabel || "Cancel",
    pendingLabel: options.pendingLabel || "",
    variant,
    confirmPhrase: String(options.confirmPhrase || "").trim(),
  };
}

export function confirmButtonLabel(confirmLabel: string, phase: ConfirmPhase, pendingLabel = "") {
  if (phase === "loading") return pendingLabel || "Working...";
  if (phase === "error") return "Try again";
  return confirmLabel;
}

export function confirmCanDismiss(phase: ConfirmPhase) {
  return phase !== "loading";
}

export function phraseAccepted(expected: string, typed: string) {
  const want = expected.trim().toUpperCase();
  if (!want) return true;
  return typed.trim().toUpperCase() === want;
}

export type Crumb = { label: string; to?: string };

const CRUMB_LABELS: Record<string, string> = {
  app: "Overview",
  customers: "Customers",
  leads: "Leads",
  tickets: "Tickets",
  packages: "Packages",
  services: "Services",
  hotspot: "Hotspot",
  billing: "Billing",
  "api-payments": "API Payments",
  statements: "Statements",
  reports: "Reports",
  routers: "Routers",
  acs: "Devices",
  radius: "RADIUS",
  ai: "AI MikroTik",
  field: "Field",
  partners: "Partners",
  import: "Import",
  settings: "Settings",
  communications: "Communications",
  notifications: "Notifications",
  payments: "Payments",
  network: "Network",
  staff: "Staff",
  plan: "Plan",
  general: "General",
  profile: "Profile",
  security: "Security",
  "recycle-bin": "Recycle Bin",
};

export function crumbsForPath(pathname: string): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "app") return [];
  const crumbs: Crumb[] = [{ label: "Overview", to: "/app" }];
  let acc = "";
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] || "";
    acc += `/${part}`;
    const last = i === parts.length - 1;
    const label = CRUMB_LABELS[part] || (part.startsWith("cus_") || part.startsWith("svc_") || part.startsWith("rtr_") ? part : prettyId(part));
    crumbs.push(last ? { label } : { label, to: `/app${acc}` });
  }
  if (crumbs.length === 1 && pathname === "/app") return [{ label: "Dashboard" }];
  return crumbs;
}

function prettyId(part: string) {
  if (part.length > 18) return "Record";
  return part.replaceAll("-", " ").replaceAll("_", " ");
}

export type SavedViewScope = "personal" | "team";

export type SavedView = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  scope: SavedViewScope;
  sort?: Record<string, unknown>;
  columns?: string[];
  density?: "comfortable" | "compact" | "dense";
};

export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const view = item as Partial<SavedView> & { is_shared?: boolean };
      if (!view.id || !view.name || !view.filters || typeof view.filters !== "object") return [];
      const scope: SavedViewScope = view.scope === "team" || view.is_shared === true ? "team" : "personal";
      const density = view.density === "compact" || view.density === "dense" || view.density === "comfortable" ? view.density : undefined;
      const columns = Array.isArray(view.columns) ? view.columns.map(String).slice(0, 40) : undefined;
      const saved: SavedView = {
        id: String(view.id),
        name: String(view.name).slice(0, 80),
        filters: view.filters as Record<string, unknown>,
        scope,
      };
      if (view.sort && typeof view.sort === "object") saved.sort = view.sort as Record<string, unknown>;
      if (columns?.length) saved.columns = columns;
      if (density) saved.density = density;
      return [saved];
    });
  } catch {
    return [];
  }
}

/** Replace a view with the same id or name. There is no hard cap. */
export function upsertSavedView(views: SavedView[], view: SavedView): SavedView[] {
  const next = views.filter((row) => row.id !== view.id && row.name.toLowerCase() !== view.name.toLowerCase());
  return [...next, view];
}

export function searchNeedle(query: string) {
  const trimmed = query.trim().slice(0, 80);
  if (trimmed.length < 2) return "";
  return trimmed.replace(/[%_\\]/g, "");
}
