export type TenantRole =
  | "isp_owner"
  | "isp_admin"
  | "finance"
  | "customer_care"
  | "network_engineer"
  | "technician"
  | "support";

export type AccessMethod = "pppoe" | "static" | "hotspot";

export type NotifyChannel = "sms" | "whatsapp" | "email" | "in_app";

export type BillingEvent =
  | "invoice.created"
  | "invoice.due"
  | "invoice.overdue"
  | "payment.received"
  | "grace.started"
  | "grace.granted"
  | "grace.ending"
  | "grace.expired"
  | "service.suspended"
  | "service.restored";

export type ServiceStatus =
  | "pending"
  | "active"
  | "grace"
  | "suspended"
  | "terminated";

export type Workspace = {
  tenantId: string;
  tenantName: string;
  slug: string;
  status: string;
  currency: string;
  role: TenantRole;
  supportEmail: string;
  supportPhone: string;
  permissions?: string[];
  supportMode?: boolean;
  supportReason?: string;
  supportExpiresAt?: string;
  supportSessionId?: string;
};

export type PackageRow = {
  id: string;
  name: string;
  description: string;
  access_method: AccessMethod;
  download_mbps: number;
  upload_mbps: number;
  price_kes: number;
  billing_interval: string;
  grace_days: number;
  bundle_mb: number;
  validity_hours: number;
  active: boolean;
};

export type CustomerRow = {
  id: string;
  type: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  status: string;
  created_at: string;
  service_count: number;
  balance_kes: number;
  churn_score: number;
  churn_band: "low" | "medium" | "high" | "churned";
  churn_reason: string;
};

export type ServiceRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  package_id: string;
  package_name: string;
  access_method: AccessMethod;
  username: string | null;
  static_ip: string | null;
  status: ServiceStatus;
  created_at: string;
  period_end: string | null;
  bundle_used_mb: number;
  bundle_mb: number;
  suspend_reason: string;
  grace_active?: boolean;
  grace_days_granted?: number | null;
  grace_starts_at?: string | null;
  grace_expires_at?: string | null;
  grace_granted_by?: string | null;
  grace_reason?: string | null;
  package_grace_days?: number;
};

export type InvoiceRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  number: string;
  amount_kes: number;
  subtotal_kes: number;
  tax_kes: number;
  tax_rate: number;
  paid_kes: number;
  remaining_kes: number;
  status: string;
  due_date: string;
  issued_at: string;
  notes?: string;
};

export type PaymentRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  invoice_id: string | null;
  provider: string;
  amount_kes: number;
  reference: string;
  status: string;
  paid_at: string;
};

export type RouterRow = {
  id: string;
  name: string;
  location: string;
  identity: string;
  role: string;
  wg_status: string;
  last_seen: string | null;
  cpu_pct: number;
  uptime_hours: number;
  enroll_token?: string;
  wg_public?: string;
  wg_address?: string;
  agent_version?: string;
};

export type TicketRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  title: string;
  category: string;
  priority: string;
  status: string;
  assigned_to?: string;
  created_at: string;
};

export type DashboardData = {
  workspace: Workspace;
  totals: {
    customers: number;
    active: number;
    suspended: number;
    online: number;
    grace: number;
    revenueMonth: number;
    revenueLastMonth: number;
    outstanding: number;
    paymentsToday: number;
    paymentsTodayCount: number;
    openTickets: number;
    routersOnline: number;
    routersTotal: number;
    avgCpu: number;
    noticesToday: number;
    liveSessions: number;
    connectionsToday: number;
    connectionsWeek: number;
    renewalsToday: number;
    atRiskHigh: number;
    atRiskMedium: number;
  };
  revenueDays: Array<{ day: string; amount: number; count: number }>;
  recentPayments: PaymentRow[];
  recentTickets: TicketRow[];
  routers: RouterRow[];
  atRisk: Array<{
    id: string;
    name: string;
    score: number;
    band: "low" | "medium" | "high" | "churned";
    reason: string;
    balance_kes: number;
  }>;
  newConnections: Array<{
    id: string;
    customer_name: string;
    package_name: string;
    access_method: string;
    status: string;
    created_at: string;
  }>;
  renewals: Array<{
    id: string;
    customer_name: string;
    package_name: string;
    period_end: string;
    status: string;
    price_kes: number;
  }>;
  dueInvoices: Array<{
    id: string;
    customer_name: string;
    number: string;
    amount_kes: number;
    paid_kes: number;
    due_date: string;
  }>;
};
