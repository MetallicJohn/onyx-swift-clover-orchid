/** Customer-safe portal contracts. Keep this module free of secrets and infra fields. */

export const PORTAL_API_VERSION = "v1" as const;

/** Versioned customer API at /api/v1/portal/:action — shared by the web portal and future Android/iOS clients. */
export const PORTAL_API_ACTIONS = [
  "network",
  "session",
  "otp",
  "otp-verify",
  "password-reset",
  "logout",
  "me",
  "dashboard",
  "services",
  "invoices",
  "payments",
  "methods",
  "tickets",
  "ticket-reply",
  "pay",
  "pay-status",
  "password",
  "invoice-pdf",
  "statement-pdf",
  "grace",
] as const;

export const PORTAL_TICKET_CATEGORIES = [
  { id: "internet_down", label: "Internet not working" },
  { id: "slow", label: "Slow service" },
  { id: "payment", label: "Payment issue" },
  { id: "mpesa", label: "M-Pesa payment" },
  { id: "billing", label: "Billing issue" },
  { id: "package", label: "Package inquiry" },
  { id: "install", label: "Installation" },
  { id: "relocation", label: "Relocation" },
  { id: "suspension", label: "Service suspension" },
  { id: "technical", label: "Technical support" },
  { id: "other", label: "Other" },
] as const;

export type PortalTicketCategoryId = (typeof PORTAL_TICKET_CATEGORIES)[number]["id"];

export type PortalAccountStatus = "active" | "inactive" | "suspended";
export type PortalServiceStatus = "active" | "grace" | "expired" | "suspended" | "pending" | "other";
export type PortalPaymentStatus = "paid" | "unpaid" | "partial" | "overdue" | "none";
export type PortalInvoiceStatus = "paid" | "due" | "overdue" | "partial" | "issued" | "cancelled" | "other";
export type PortalStkStatus = "pending" | "confirmed" | "failed" | "cancelled" | "timeout";

export type PortalCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  account_status: PortalAccountStatus;
  using_initial_password: boolean;
};

export type PortalIsp = {
  name: string;
  slug: string;
  support_phone: string;
  support_email: string;
  date_format: string;
};

export type PortalService = {
  id: string;
  reference: string;
  account_number: string;
  name: string;
  package_name: string;
  package_price_kes: number;
  access_type: string;
  location: string;
  billing_period: string;
  renewal_date: string | null;
  expiry_date: string | null;
  days_remaining: number | null;
  next_billing_period: string | null;
  status: PortalServiceStatus;
  status_label: string;
  payment_status: PortalPaymentStatus;
  payment_status_label: string;
  outstanding_kes: number;
  grace_until: string | null;
  can_request_grace: boolean;
  grace_reason: string | null;
  allowed_grace_days: number[];
  partial_available?: boolean;
  partial_min_pct?: number;
  partial_min_kes?: number;
  partial_full_kes?: number;
  partial_paid_kes?: number;
  partial_period_ms?: number;
  partial_hourly?: boolean;
  tier?: string;
  credit_enabled?: boolean;
  credit_max_kes?: number;
  credit_available_kes?: number;
  credit_outstanding_kes?: number;
  credit_utilization_pct?: number;
  credit_warning?: boolean;
  credit_label?: string;
};

export type PortalInvoice = {
  id: string;
  number: string;
  service_id: string | null;
  service_name: string;
  account_number: string;
  issued_at: string;
  due_date: string;
  billing_period: string;
  package_name: string;
  amount_kes: number;
  paid_kes: number;
  balance_kes: number;
  status: PortalInvoiceStatus;
  status_label: string;
};

export type PortalPayment = {
  id: string;
  paid_at: string;
  amount_kes: number;
  method: string;
  reference_masked: string;
  invoice_number: string | null;
  service_name: string | null;
  status: string;
  receipt_status: string;
};

export type PortalPaymentMethod = {
  id: string;
  kind: string;
  label: string;
  mode: "stk" | "paybill" | "till" | "bank" | "card" | "other";
  instructions: string;
  public_number: string;
  stk_available: boolean;
};

export type PortalTicketComment = {
  id: string;
  author: "you" | "support";
  body: string;
  created_at: string;
};

export type PortalTicket = {
  id: string;
  title: string;
  category: string;
  category_label: string;
  status: string;
  status_label: string;
  service_id: string | null;
  created_at: string;
  comments: PortalTicketComment[];
};

export type PortalDashboard = {
  customer: PortalCustomer;
  isp: PortalIsp;
  services_total: number;
  services_active: number;
  services_expired: number;
  services_suspended: number;
  services_grace: number;
  outstanding_kes: number;
  unpaid_invoices: number;
  open_tickets: number;
  next_renewal: string | null;
  latest_payment: PortalPayment | null;
  using_initial_password: boolean;
  points: number;
};

export type PortalHome = {
  customer: PortalCustomer;
  isp: PortalIsp;
  dashboard: PortalDashboard;
  services: PortalService[];
  invoices: PortalInvoice[];
  payments: PortalPayment[];
  methods: PortalPaymentMethod[];
  tickets: PortalTicket[];
  points: number;
};

export type PortalPaymentPage = {
  rows: PortalPayment[];
  total: number;
  page: number;
  page_size: number;
};

export type PortalStkStart = {
  intent_id: string;
  checkout_id: string;
  amount_kes: number;
  phone: string;
  invoice_number: string;
  account_number: string;
  service_id: string;
  service_name: string;
  status: "pending";
  note: string;
};

export type PortalStkPoll = {
  status: PortalStkStatus;
  note: string;
  payment_id?: string;
  amount_kes?: number;
  reference_masked?: string;
};
