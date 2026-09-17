/** Client-safe helpers for the Reassign Service dialog. No SQL, no Node APIs. */

import { last9Phone } from "./customer-portal-format.ts";
import { normalizePhone } from "./phone.ts";

export const REASSIGN_SEARCH_MIN = 2;
export const REASSIGN_SEARCH_LIMIT = 20;

export type ReassignServiceInfo = {
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
};

export type ReassignCustomerHit = {
  id: string;
  name: string;
  phone: string;
  email: string;
  account_number: string;
  address: string;
  status: string;
  active_services: number;
};

export function displayReassignPhone(raw: string) {
  const n = normalizePhone(raw);
  if (/^254[17]\d{8}$/.test(n)) return `0${n.slice(3)}`;
  return String(raw || "").trim();
}

export function reassignSearchReady(q: string) {
  return q.trim().length >= REASSIGN_SEARCH_MIN;
}

export function canSubmitReassign(opts: {
  destinationId?: string | null;
  currentCustomerId: string;
  confirmed: boolean;
  busy?: boolean;
}) {
  if (opts.busy) return false;
  if (!opts.confirmed) return false;
  const dest = String(opts.destinationId || "").trim();
  if (!dest) return false;
  if (dest === opts.currentCustomerId) return false;
  return true;
}

export function customerUnavailable(status: string, deletedAt?: string | null) {
  if (deletedAt) return true;
  const s = String(status || "").toLowerCase();
  return s === "deleted" || s === "inactive" || s === "archived";
}

export function customerStatusLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "suspended") return "Suspended";
  if (s === "inactive") return "Inactive";
  if (s === "deleted") return "Deleted";
  return "Active";
}

export function last9ForSearch(raw: string) {
  return last9Phone(raw);
}

export function reassignInfoFromRow(row: {
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
}): ReassignServiceInfo {
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone || "",
    customer_account_number: row.customer_account_number || "",
    account_number: row.account_number || "",
    package_name: row.package_name,
    access_method: row.access_method,
    status: row.status,
    period_end: row.period_end || null,
  };
}
