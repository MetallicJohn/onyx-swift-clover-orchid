import type { ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PortalInvoice, PortalPayment, PortalService } from "@/lib/isp/customer-portal-dto";
import { formatDate } from "@/lib/isp/display";
import { cn, kes } from "@/lib/utils";

export function PortalCard({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl bg-surface p-4 shadow-card sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-sm font-medium tracking-tight">{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "danger" | "muted";
}) {
  return (
    <div className="rounded-lg bg-elevated/60 px-3 py-3">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums tracking-tight", tone === "danger" && "text-danger", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-10 text-center shadow-card">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger">
      <p>{message}</p>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label={label}>
      <div className="h-20 animate-pulse rounded-xl bg-elevated" />
      <div className="h-20 animate-pulse rounded-xl bg-elevated" />
    </div>
  );
}

export function PasswordBanner({ onChange, onDismiss }: { onChange: () => void; onDismiss: () => void }) {
  return (
    <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm">
      <p className="font-medium text-fg">Change the default password</p>
      <p className="mt-1 text-muted">
        Your first password is your phone number. Changing it is recommended for security. You can keep using the portal until you do.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onChange}>
          Change password
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Later
        </Button>
      </div>
    </div>
  );
}

export function ServiceCard({
  service,
  onPay,
  grace,
}: {
  service: PortalService;
  onPay?: () => void;
  grace?: ReactNode;
}) {
  return (
    <li className="rounded-lg bg-elevated/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{service.name}</p>
          <p className="text-xs text-muted">{service.reference}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={statusTone(service.status === "grace" ? "grace" : service.status)}>{service.status_label}</Badge>
          <Badge tone={statusTone(service.payment_status)}>{service.payment_status_label}</Badge>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Package</dt>
          <dd>{service.package_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Price</dt>
          <dd className="tabular-nums">{kes(service.package_price_kes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Billing period</dt>
          <dd>{service.billing_period}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Next period</dt>
          <dd>{service.next_billing_period || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Renewal</dt>
          <dd>{service.renewal_date ? formatDate(service.renewal_date) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Expiry</dt>
          <dd>
            {service.expiry_date ? formatDate(service.expiry_date) : "—"}
            {service.days_remaining != null ? (
              <span className="block text-xs text-muted">
                {service.days_remaining < 0
                  ? "Expired"
                  : service.days_remaining === 0
                    ? "Ends today"
                    : `${service.days_remaining} day${service.days_remaining === 1 ? "" : "s"} left`}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      {service.outstanding_kes > 0 ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-sm">
            Balance <span className="font-medium tabular-nums">{kes(service.outstanding_kes)}</span>
          </p>
          {onPay ? (
            <Button size="sm" onClick={onPay}>
              Pay now
            </Button>
          ) : null}
        </div>
      ) : null}
      {service.status === "grace" && service.grace_until ? (
        <p className="mt-2 text-xs text-warn">Grace Period until {formatDate(service.grace_until)}. Renewal date is unchanged.</p>
      ) : null}
      {grace}
    </li>
  );
}

export function InvoiceRow({
  invoice,
  onPay,
  onPdf,
  onPrint,
}: {
  invoice: PortalInvoice;
  onPay?: () => void;
  onPdf?: () => void;
  onPrint?: () => void;
}) {
  return (
    <li className="border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{invoice.number}</p>
          <p className="text-xs text-muted">{invoice.package_name}</p>
        </div>
        <Badge tone={statusTone(invoice.status)}>{invoice.status_label}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">Invoice date</dt>
          <dd>{formatDate(invoice.issued_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Due date</dt>
          <dd>{formatDate(invoice.due_date)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Billing period</dt>
          <dd>{invoice.billing_period}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Amount</dt>
          <dd className="tabular-nums">{kes(invoice.amount_kes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Paid</dt>
          <dd className="tabular-nums">{kes(invoice.paid_kes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Balance</dt>
          <dd className="font-medium tabular-nums">{kes(invoice.balance_kes)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {onPdf ? (
          <Button size="sm" variant="secondary" onClick={onPdf}>
            Download
          </Button>
        ) : null}
        {onPrint ? (
          <Button size="sm" variant="ghost" onClick={onPrint}>
            Print
          </Button>
        ) : null}
        {invoice.balance_kes > 0 && onPay ? (
          <Button size="sm" onClick={onPay}>
            Pay now
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function PaymentRow({ payment }: { payment: PortalPayment }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0">
      <div>
        <p className="font-medium tabular-nums">{kes(payment.amount_kes)}</p>
        <p className="text-xs text-muted">
          {formatDate(payment.paid_at)} · {payment.method}
          {payment.invoice_number ? ` · ${payment.invoice_number}` : ""}
          {payment.service_name ? ` · ${payment.service_name}` : ""}
        </p>
      </div>
      <div className="text-right text-xs">
        <p className="font-mono text-muted">{payment.reference_masked}</p>
        <div className="mt-1 flex flex-col items-end gap-1">
          <Badge tone={statusTone(payment.status)}>{payment.status}</Badge>
          <span className="text-subtle">{payment.receipt_status === "available" ? "Receipt ready" : "Receipt pending"}</span>
        </div>
      </div>
    </li>
  );
}

export function SupportLine({ phone, email }: { phone: string; email: string }) {
  if (!phone && !email) return null;
  return (
    <p className="text-sm text-muted">
      Need help?{" "}
      {phone ? (
        <a className="text-accent hover:underline" href={`tel:${phone}`}>
          {phone}
        </a>
      ) : null}
      {phone && email ? " · " : null}
      {email ? (
        <a className="text-accent hover:underline" href={`mailto:${email}`}>
          {email}
        </a>
      ) : null}
    </p>
  );
}
