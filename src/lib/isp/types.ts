export type TenantRole =
  | "isp_owner"
  | "isp_admin"
  | "finance"
  | "customer_care"
  | "network_engineer"
  | "technician";

export type AccessMethod = "pppoe" | "static" | "hotspot";

export type NotifyChannel = "sms" | "whatsapp" | "email" | "in_app";

export type BillingEvent =
  | "invoice.created"
  | "invoice.due"
  | "invoice.overdue"
  | "payment.received"
  | "grace.started"
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
};

export type InvoiceRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  number: string;
  amount_kes: number;
  status: string;
  due_date: string;
  issued_at: string;
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
    revenueMonth: number;
    outstanding: number;
    paymentsToday: number;
    openTickets: number;
    routersOnline: number;
    routersTotal: number;
    noticesToday: number;
  };
  recentPayments: PaymentRow[];
  recentTickets: TicketRow[];
  routers: RouterRow[];
};
