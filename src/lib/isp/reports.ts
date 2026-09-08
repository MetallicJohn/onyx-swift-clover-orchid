import { tallyAging } from "./aging";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function loadReports(sql: Sql, tenantId: string) {
  const invoices = await sql<{ status: string; due_date: string; amount_kes: number }>`
    select status, due_date::text as due_date, amount_kes from invoices where tenant_id = ${tenantId}`;
  const aging = tallyAging(invoices);
  const daily = await sql<{ day: string; amount: number; n: number }>`
    select paid_at::date::text as day, coalesce(sum(amount_kes),0)::int as amount, count(*)::int as n
    from payments where tenant_id = ${tenantId} and status = 'confirmed'
    group by paid_at::date order by day desc limit 14`;
  const methods = await sql<{ access_method: string; n: number; active: number }>`
    select access_method, count(*)::int as n,
           count(*) filter (where status = 'active')::int as active
    from services where tenant_id = ${tenantId} group by access_method`;
  const tickets = await sql<{ status: string; n: number }>`
    select status, count(*)::int as n from tickets where tenant_id = ${tenantId} group by status`;
  const routers = await sql<{ wg_status: string; n: number }>`
    select wg_status, count(*)::int as n from routers where tenant_id = ${tenantId} group by wg_status`;
  return { aging, daily, methods, tickets, routers };
}

export async function loadAudit(sql: Sql, tenantId: string) {
  return sql<{
    id: string;
    user_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }>`select id, user_id, action, entity_type, entity_id, created_at::text as created_at
     from audit_logs where tenant_id = ${tenantId} order by created_at desc limit 80`;
}

export async function loadStatement(sql: Sql, tenantId: string, customerId: string) {
  const [customer] = await sql<{
    id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
  }>`select id, name, phone, email, address from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  if (!customer) throw new Error("Customer not found");
  const invoices = await sql<{
    number: string;
    amount_kes: number;
    status: string;
    due_date: string;
  }>`select number, amount_kes, status, due_date::text as due_date
     from invoices where tenant_id = ${tenantId} and customer_id = ${customerId} order by issued_at desc`;
  const payments = await sql<{
    reference: string;
    provider: string;
    amount_kes: number;
    paid_at: string;
    status: string;
  }>`select reference, provider, amount_kes, paid_at::text as paid_at, status
     from payments where tenant_id = ${tenantId} and customer_id = ${customerId} order by paid_at desc`;
  const ledger = await sql<{
    entry_type: string;
    debit_kes: number;
    credit_kes: number;
    memo: string;
    created_at: string;
  }>`select entry_type, debit_kes, credit_kes, memo, created_at::text as created_at
     from customer_ledger where tenant_id = ${tenantId} and customer_id = ${customerId}
     order by created_at desc limit 50`;
  const [bal] = await sql<{ debit: number; credit: number }>`
    select coalesce(sum(debit_kes),0)::int as debit, coalesce(sum(credit_kes),0)::int as credit
    from customer_ledger where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  return {
    customer,
    invoices,
    payments,
    ledger,
    balance: (bal?.debit ?? 0) - (bal?.credit ?? 0),
  };
}
