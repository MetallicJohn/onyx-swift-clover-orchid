import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { DateYmdInput } from "@/components/isp/date-ymd-input";
import { formatDate } from "@/lib/isp/display";
import { effectiveAccessIso, expirySourceLabel, previewStaffExpiry } from "@/lib/isp/service-expiry-format";
import type { ServiceRow } from "@/lib/isp/types";

export type ExpiryForm = { service: ServiceRow; date: string; reason: string };

export function ExpiryEditor({
  form,
  setForm,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  form: ExpiryForm;
  setForm: (next: ExpiryForm) => void;
  busy: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  const s = form.service;
  let preview: ReturnType<typeof previewStaffExpiry> | null = null;
  let parseError = "";
  if (form.date) {
    try {
      preview = previewStaffExpiry({
        ymd: form.date,
        status: s.status,
        suspend_reason: s.suspend_reason,
        bundle_used_mb: s.bundle_used_mb,
        bundle_mb: s.bundle_mb,
      });
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Invalid date";
    }
  }
  const expected = preview?.expectedStatus === "grace" ? "Grace Period" : preview?.expectedStatus || "—";
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Customer</dt>
          <dd className="font-medium">{s.customer_name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Service Account Number</dt>
          <dd className="font-mono text-xs">{s.account_number || "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Service</dt>
          <dd>
            {s.package_name} · {s.access_method.toUpperCase()}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Current expiry</dt>
          <dd>
            {formatDate(effectiveAccessIso(s))}
            <span className="ml-2 text-xs text-subtle">{expirySourceLabel(s.expiry_source, s.grace_active)}</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Paid through (billing)</dt>
          <dd>{formatDate(s.period_end)}</dd>
        </div>
      </dl>
      <Field label="New expiry date">
        <DateYmdInput
          value={form.date}
          onChange={(ymd) => setForm({ ...form, date: ymd })}
          required
          disabled={busy}
          aria-label="New expiry date"
        />
      </Field>
      {form.date ? (
        <p className="text-sm">
          Selected date: <span className="font-medium">{formatDate(`${form.date}T12:00:00+03:00`)}</span>
          {" · "}
          Expected status: <span className="font-medium">{expected}</span>
        </p>
      ) : null}
      {preview?.expectedReason === "manual" ? (
        <p className="text-sm text-warn">
          This date is today or in the future, but the line stays suspended because of a manual hold. No invoice,
          billing action, SMS or email will be generated.
        </p>
      ) : preview?.expectedReason === "bundle" ? (
        <p className="text-sm text-warn">
          This date is today or in the future, but the line stays suspended because the data cap is used up. No invoice,
          billing action, SMS or email will be generated.
        </p>
      ) : preview?.expectedReason === "terminated" || preview?.expectedStatus === "terminated" ? (
        <p className="text-sm text-warn">
          This line is terminated. The access date is recorded, but the service stays terminated. No invoice, billing
          action, SMS or email will be generated.
        </p>
      ) : preview?.past ? (
        <p className="text-sm text-warn">
          This date is in the past. The service will be suspended. No invoice, billing action, SMS or email will be
          generated.
        </p>
      ) : preview ? (
        <p className="text-sm text-muted">
          This date is today or in the future. The service will be restored if no other suspension condition applies. No
          invoice, billing action, SMS or email will be generated.
        </p>
      ) : null}
      <Field label="Reason">
        <Input
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          placeholder="Why this access date is changing"
          required
          disabled={busy}
        />
      </Field>
      {parseError ? <p className="text-sm text-danger">{parseError}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !form.date || !form.reason.trim() || Boolean(parseError)}>
          {busy ? "Saving…" : "Confirm expiry date"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
