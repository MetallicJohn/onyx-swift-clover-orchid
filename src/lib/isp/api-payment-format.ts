export function apiPaymentMethodLabel(provider: string, channel: string) {
  const p = (provider || "").toLowerCase();
  const c = (channel || "").toLowerCase();
  if (p === "mpesa" && c === "paybill") return "M-Pesa PayBill";
  if (p === "mpesa" && c === "till") return "M-Pesa Till";
  if (p === "mpesa" && c === "stk") return "M-Pesa STK";
  if (p === "kopokopo") return "Kopo Kopo";
  const name = [provider, channel].filter(Boolean).join(" ");
  return name || "API";
}

export function apiPaymentStatusLabel(status: string) {
  if (status === "matched" || status === "assigned") return "Processed";
  if (status === "processing_failed") return "Processing failed";
  if (status === "unmatched") return "Unmatched";
  if (status === "reversed") return "Reversed";
  if (status === "processing") return "Processing";
  return status || "Received";
}

/** Green only after the payment pipeline succeeded. */
export function apiAccountTone(status: string): "ok" | "danger" | "warn" | "muted" {
  if (status === "matched" || status === "assigned") return "ok";
  if (status === "unmatched") return "danger";
  if (status === "processing_failed" || status === "processing") return "warn";
  return "muted";
}

export function apiPaymentProcessed(status: string) {
  return status === "matched" || status === "assigned";
}
