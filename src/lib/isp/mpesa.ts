type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type MpesaConfig = {
  client_id: string;
  client_secret: string;
  till_number: string;
  passkey: string;
  stk_type: string;
  sandbox: boolean;
  enabled: boolean;
};

function baseUrl(sandbox: boolean) {
  return sandbox ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
}

function nairobiStamp() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}${g("month")}${g("day")}${g("hour")}${g("minute")}${g("second")}`;
}

export function msisdn254(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("254")) return d;
  if (d.startsWith("0") && d.length >= 10) return `254${d.slice(1)}`;
  if (d.length === 9) return `254${d}`;
  return d;
}

export async function loadMpesa(sql: Sql, tenantId: string): Promise<MpesaConfig | null> {
  const rows = await sql<MpesaConfig>`
    select client_id, client_secret, till_number, passkey, stk_type, sandbox, enabled
    from payment_providers where tenant_id = ${tenantId} and kind = 'mpesa'`;
  return rows[0] ?? null;
}

function password(shortcode: string, passkey: string, timestamp: string) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

export async function mpesaAccessToken(cfg: MpesaConfig) {
  const basic = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString("base64");
  const res = await fetch(`${baseUrl(cfg.sandbox)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Daraja token ${res.status}: ${text.slice(0, 120)}`);
  const j = JSON.parse(text) as { access_token?: string };
  if (!j.access_token) throw new Error("Daraja did not return an access token");
  return j.access_token;
}

export async function mpesaStkPush(
  cfg: MpesaConfig,
  opts: { phone: string; amount: number; account: string; description: string; callbackUrl?: string },
) {
  if (!cfg.till_number) throw new Error("Set the M-Pesa shortcode in Settings");
  if (!cfg.passkey) throw new Error("Set the Lipa Na M-Pesa passkey in Settings");
  const phone = msisdn254(opts.phone);
  if (!phone) throw new Error("Customer phone is required for M-Pesa STK");
  const ts = nairobiStamp();
  const token = await mpesaAccessToken(cfg);
  const buyGoods = cfg.stk_type === "till";
  const res = await fetch(`${baseUrl(cfg.sandbox)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: cfg.till_number,
      Password: password(cfg.till_number, cfg.passkey, ts),
      Timestamp: ts,
      TransactionType: buyGoods ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: opts.amount,
      PartyA: phone,
      PartyB: cfg.till_number,
      PhoneNumber: phone,
      CallBackURL: opts.callbackUrl || undefined,
      AccountReference: opts.account.slice(0, 12) || "BILL",
      TransactionDesc: opts.description.slice(0, 13) || "Internet",
    }),
  });
  const text = await res.text();
  let j: {
    ResponseCode?: string;
    CustomerMessage?: string;
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    errorMessage?: string;
    errorCode?: string;
  };
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`Daraja STK ${res.status}: ${text.slice(0, 160)}`);
  }
  if (!res.ok || (j.ResponseCode && j.ResponseCode !== "0")) {
    throw new Error(j.errorMessage || j.CustomerMessage || `Daraja STK ${res.status}`);
  }
  if (!j.CheckoutRequestID) throw new Error("Daraja did not return CheckoutRequestID");
  return {
    checkout_id: j.CheckoutRequestID,
    merchant_id: j.MerchantRequestID ?? "",
    message: j.CustomerMessage ?? "STK push sent",
  };
}

export async function mpesaStkQuery(cfg: MpesaConfig, checkoutRequestId: string) {
  const ts = nairobiStamp();
  const token = await mpesaAccessToken(cfg);
  const res = await fetch(`${baseUrl(cfg.sandbox)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: cfg.till_number,
      Password: password(cfg.till_number, cfg.passkey, ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  const text = await res.text();
  const j = JSON.parse(text) as {
    ResponseCode?: string;
    ResultCode?: string;
    ResultDesc?: string;
    errorMessage?: string;
  };
  if (!res.ok && !j.ResultCode) {
    throw new Error(j.errorMessage || `Daraja query ${res.status}`);
  }
  return {
    resultCode: j.ResultCode ?? "",
    resultDesc: j.ResultDesc ?? j.errorMessage ?? "",
    ok: j.ResultCode === "0",
  };
}
