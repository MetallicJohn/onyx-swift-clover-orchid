export type AgingBucket = "current" | "1-30" | "31-60" | "60+" | "paid";

export function invoiceAging(status: string, dueDate: string, today = new Date()): AgingBucket {
  if (status === "paid") return "paid";
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return "current";
  const days = Math.floor((today.getTime() - due.getTime()) / 86400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  return "60+";
}

export function tallyAging(rows: Array<{ status: string; due_date: string; amount_kes: number }>, today = new Date()) {
  const out: Record<AgingBucket, { count: number; amount: number }> = {
    current: { count: 0, amount: 0 },
    "1-30": { count: 0, amount: 0 },
    "31-60": { count: 0, amount: 0 },
    "60+": { count: 0, amount: 0 },
    paid: { count: 0, amount: 0 },
  };
  for (const r of rows) {
    const b = invoiceAging(r.status, r.due_date, today);
    out[b].count += 1;
    out[b].amount += r.amount_kes;
  }
  return out;
}
