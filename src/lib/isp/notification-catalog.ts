import type { BillingEvent } from "./types.ts";

export type NotifyPlaceholder = {
  key: string;
  label: string;
};

export const NOTIFY_PLACEHOLDERS: NotifyPlaceholder[] = [
  { key: "customer_name", label: "Customer name" },
  { key: "service_name", label: "Service name" },
  { key: "service_account_number", label: "Service account" },
  { key: "service_status", label: "Service status" },
  { key: "service_expiry_date", label: "Expiry date" },
  { key: "amount_due", label: "Amount due" },
  { key: "amount", label: "Amount" },
  { key: "paybill_number", label: "Paybill" },
  { key: "account_instructions", label: "Payment instructions" },
  { key: "invoice_number", label: "Invoice number" },
  { key: "payment_reference", label: "Payment reference" },
  { key: "due_date", label: "Due date" },
  { key: "company_name", label: "Company name" },
  { key: "isp_name", label: "ISP name" },
  { key: "support_contact", label: "Support contact" },
  { key: "amount_received", label: "Amount received" },
  { key: "full_package_amount", label: "Full package amount" },
  { key: "payment_percentage", label: "Payment percentage" },
  { key: "required_percentage", label: "Required percentage" },
  { key: "minimum_payment_amount", label: "Minimum payment" },
  { key: "remaining_activation_amount", label: "Remaining activation amount" },
  { key: "validity_days", label: "Validity days" },
  { key: "outstanding_balance", label: "Outstanding balance" },
  { key: "maximum_credit_amount", label: "Credit limit" },
  { key: "available_credit", label: "Available credit" },
  { key: "current_period_amount", label: "Current period amount" },
  { key: "receipt_number", label: "Receipt number" },
];

export const NOTIFICATION_CATALOG: Array<{
  category: string;
  events: Array<{ code: BillingEvent; label: string }>;
}> = [
  {
    category: "Customer Registration",
    events: [
      { code: "customer.created", label: "Customer Created" },
      { code: "service.created", label: "Service Created" },
      { code: "service.created.awaiting_payment", label: "Service Created — Awaiting Payment" },
      { code: "service.created.active", label: "Service Created — Active" },
    ],
  },
  {
    category: "Payments",
    events: [
      { code: "payment.received", label: "Payment Received" },
      { code: "payment.received.awaiting", label: "Payment Received for Awaiting Service" },
    ],
  },
  {
    category: "Partial payments",
    events: [
      { code: "payment.partial.received", label: "Partial Payment Received" },
      { code: "payment.partial.below_minimum", label: "Partial Payment Below Minimum" },
      { code: "payment.partial.activated", label: "Partial Payment Service Activated" },
      { code: "payment.partial.restored", label: "Partial Payment Service Restored" },
      { code: "payment.partial.remaining", label: "Partial Payment Remaining Balance" },
    ],
  },
  {
    category: "Service Lifecycle",
    events: [
      { code: "service.activated", label: "Service Activated" },
      { code: "service.restored", label: "Service Restored" },
      { code: "service.suspended", label: "Service Suspended" },
      { code: "service.expired", label: "Service Expired" },
    ],
  },
  {
    category: "Billing",
    events: [
      { code: "invoice.created", label: "Invoice Created" },
      { code: "invoice.due", label: "Invoice Due" },
      { code: "invoice.overdue", label: "Invoice Overdue" },
      { code: "grace.started", label: "Grace Started" },
      { code: "grace.granted", label: "Grace Granted" },
      { code: "grace.ending", label: "Grace Ending" },
      { code: "grace.expired", label: "Grace Expired" },
    ],
  },
  {
    category: "Business credit",
    events: [
      { code: "invoice.created.business", label: "Business Invoice Generated" },
      { code: "invoice.overdue.business", label: "Business Overdue — Within Credit" },
      { code: "credit.warning", label: "Credit Limit Warning" },
      { code: "credit.limit_reached", label: "Credit Limit Reached" },
      { code: "payment.received.business", label: "Business Payment Received" },
      { code: "service.restored.business", label: "Business Service Restored" },
    ],
  },
];

export const PAYMENT_NOTIFY_EVENTS = new Set<BillingEvent>([
  "payment.received",
  "payment.received.awaiting",
  "service.restored",
  "service.activated",
  "payment.partial.received",
  "payment.partial.below_minimum",
  "payment.partial.activated",
  "payment.partial.restored",
  "payment.partial.remaining",
  "payment.received.business",
  "service.restored.business",
]);

export function eventLabel(code: string) {
  for (const group of NOTIFICATION_CATALOG) {
    const hit = group.events.find((e) => e.code === code);
    if (hit) return hit.label;
  }
  return code;
}

export function placeholderToken(key: string) {
  return `{{${key}}}`;
}
