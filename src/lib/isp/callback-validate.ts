export type CallbackDecision =
  | { action: "idempotent" }
  | { action: "ignore"; reason: string }
  | { action: "fail"; reason: string; intentStatus: "failed" | "cancelled" }
  | { action: "reconcile"; reason: string }
  | { action: "confirm"; reference: string };

export type ParsedStkCallback = {
  checkout: string;
  resultCode: number;
  resultDesc: string;
  receipt: string;
  amount?: number;
  phone?: string;
};

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function metaItem(body: Record<string, unknown>, name: string) {
  const stk = (body.Body as Record<string, unknown> | undefined)?.stkCallback as Record<string, unknown> | undefined;
  const meta = stk?.CallbackMetadata as { Item?: Array<{ Name?: string; Value?: unknown }> } | undefined;
  const hit = meta?.Item?.find((i) => i.Name === name);
  return hit?.Value;
}

export function parseMpesaCallback(body: Record<string, unknown>): ParsedStkCallback {
  const stk = (body.Body as Record<string, unknown> | undefined)?.stkCallback as
    | { CheckoutRequestID?: string; ResultCode?: number; ResultDesc?: string }
    | undefined;
  return {
    checkout: String(stk?.CheckoutRequestID || ""),
    resultCode: Number(stk?.ResultCode ?? -1),
    resultDesc: String(stk?.ResultDesc || ""),
    receipt: String(metaItem(body, "MpesaReceiptNumber") || ""),
    amount: asNumber(metaItem(body, "Amount")),
    phone: String(metaItem(body, "PhoneNumber") || ""),
  };
}

export function parseKopokopoCallback(body: Record<string, unknown>): ParsedStkCallback {
  const data = body.data as Record<string, unknown> | undefined;
  const attrs = data?.attributes as Record<string, unknown> | undefined;
  const event = (body.event as Record<string, unknown> | undefined) || (attrs?.event as Record<string, unknown> | undefined);
  const resource = (event?.resource as Record<string, unknown> | undefined) || {};
  const status = String(attrs?.status || resource.status || "");
  const ok = /success|received/i.test(status);
  const amountRaw = resource.amount as { value?: unknown } | string | number | undefined;
  const amount =
    typeof amountRaw === "object" && amountRaw ? asNumber(amountRaw.value) : asNumber(amountRaw);
  return {
    checkout: String(data?.id || body.id || resource.id || ""),
    resultCode: ok ? 0 : 1,
    resultDesc: status,
    receipt: String(resource.reference || ""),
    amount,
    phone: String(resource.sender_phone_number || resource.phone || ""),
  };
}

export function evaluateStkCallback(
  intent: { status: string; checkout_id: string; amount_kes: number },
  parsed: ParsedStkCallback,
): CallbackDecision {
  if (intent.status === "confirmed") return { action: "idempotent" };
  if (!parsed.checkout || parsed.checkout !== intent.checkout_id) {
    return { action: "ignore", reason: "checkout mismatch" };
  }
  if (parsed.resultCode !== 0) {
    const cancelled = parsed.resultCode === 1032;
    return {
      action: "fail",
      reason: parsed.resultDesc || `ResultCode ${parsed.resultCode}`,
      intentStatus: cancelled ? "cancelled" : "failed",
    };
  }
  if (parsed.amount != null && Math.round(parsed.amount) !== intent.amount_kes) {
    return {
      action: "reconcile",
      reason: `amount mismatch callback=${parsed.amount} invoice=${intent.amount_kes}`,
    };
  }
  const reference = parsed.receipt.trim() || parsed.checkout;
  if (!reference) return { action: "reconcile", reason: "missing receipt" };
  return { action: "confirm", reference };
}
