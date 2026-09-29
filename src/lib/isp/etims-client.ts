import { oscuBaseUrl, redactSecrets, type EtimsEnvironment } from "./etims-format.ts";

export type OscuBody = {
  resultCd: string;
  resultMsg: string;
  data: unknown;
};

export type OscuResult = OscuBody & { httpStatus: number };

export class OscuError extends Error {
  httpStatus: number;
  resultCd: string;
  kind: "rejected" | "transient";

  constructor(message: string, opts: { httpStatus: number; resultCd: string; kind: "rejected" | "transient" }) {
    super(message);
    this.name = "OscuError";
    this.httpStatus = opts.httpStatus;
    this.resultCd = opts.resultCd;
    this.kind = opts.kind;
  }
}

export async function oscuPost(opts: {
  environment: EtimsEnvironment;
  path: string;
  body: unknown;
  tin?: string;
  bhfId?: string;
  cmcKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OscuResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.tin) headers.tin = opts.tin;
  if (opts.bhfId) headers.bhfId = opts.bhfId;
  if (opts.cmcKey) headers.cmcKey = opts.cmcKey;
  const url = `${oscuBaseUrl(opts.environment)}${opts.path}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : "KRA eTIMS request failed", [opts.cmcKey || ""]);
    throw new OscuError(message, { httpStatus: 0, resultCd: "", kind: "transient" });
  }
  let parsed: OscuBody = { resultCd: "", resultMsg: "", data: null };
  try {
    const json = (await response.json()) as Partial<OscuBody>;
    parsed = {
      resultCd: String(json.resultCd || ""),
      resultMsg: redactSecrets(String(json.resultMsg || ""), [opts.cmcKey || ""]),
      data: json.data ?? null,
    };
  } catch {
    throw new OscuError("KRA eTIMS returned an unreadable response", {
      httpStatus: response.status || 0,
      resultCd: "",
      kind: response.status >= 500 || response.status === 0 ? "transient" : "rejected",
    });
  }
  return { httpStatus: response.status, ...parsed, resultMsg: parsed.resultMsg || `HTTP ${response.status}` };
}
