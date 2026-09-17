import { promises as dns } from "node:dns";
import https from "node:https";
import tls from "node:tls";
import {
  isLoopbackHostname,
  isPrivateIpv4,
  isPrivateIpv6,
  isValidHostname,
  normalizeHostname,
  originFromHostname,
  txtVerificationName,
} from "./domain-format.ts";
import { productionDomainContext } from "./domain-resolve.ts";

export type DnsLookupResult = {
  a: string[];
  aaaa: string[];
  cname: string[];
  txt: string[][];
};

export type TlsProbeResult = {
  ok: boolean;
  authorized: boolean;
  subject: string;
  issuer: string;
  expiresAt: string | null;
  hostMatched: boolean;
  statusCode: number | null;
  error: string;
};

export type DnsLookupFn = (hostname: string) => Promise<DnsLookupResult>;
export type TlsProbeFn = (hostname: string) => Promise<TlsProbeResult>;

const emptyLookup = (): DnsLookupResult => ({ a: [], aaaa: [], cname: [], txt: [] });

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

export async function defaultDnsLookup(hostname: string): Promise<DnsLookupResult> {
  const host = normalizeHostname(hostname);
  const out = emptyLookup();
  if (!host || !isValidHostname(host)) return out;
  const settle = async <T>(p: Promise<T>, fallback: T) => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };
  const [a, aaaa, cname, txt] = await Promise.all([
    settle(dns.resolve4(host), [] as string[]),
    settle(dns.resolve6(host), [] as string[]),
    settle(dns.resolveCname(host), [] as string[]),
    settle(dns.resolveTxt(host), [] as string[][]),
  ]);
  out.a = a;
  out.aaaa = aaaa;
  out.cname = cname.map((c) => normalizeHostname(c));
  out.txt = txt;
  return out;
}

function cnOf(value: string | string[] | undefined) {
  if (!value) return "";
  return Array.isArray(value) ? value[0] || "" : value;
}

function certNameList(cert: tls.PeerCertificate) {
  const names = new Set<string>();
  const cn = cnOf(cert.subject?.CN);
  if (cn) names.add(cn.toLowerCase());
  const alt = cert.subjectaltname || "";
  for (const part of alt.split(",")) {
    const v = part.trim();
    if (v.toLowerCase().startsWith("dns:")) names.add(v.slice(4).trim().toLowerCase());
  }
  return [...names];
}

function hostnameMatchesCert(hostname: string, names: string[]) {
  const h = normalizeHostname(hostname);
  for (const name of names) {
    const n = name.replace(/^\*\./, "");
    if (name === h) return true;
    if (name.startsWith("*.") && h.endsWith(`.${n}`) && h.split(".").length === n.split(".").length + 1) {
      return true;
    }
  }
  return false;
}

function isBlockedIp(ip: string, production: boolean) {
  if (isLoopbackHostname(ip) || isPrivateIpv4(ip) || isPrivateIpv6(ip)) return production || !isLoopbackHostname(ip);
  return false;
}

export async function defaultTlsProbe(hostname: string): Promise<TlsProbeResult> {
  const host = normalizeHostname(hostname);
  const fail = (error: string): TlsProbeResult => ({
    ok: false,
    authorized: false,
    subject: "",
    issuer: "",
    expiresAt: null,
    hostMatched: false,
    statusCode: null,
    error,
  });
  if (!host) return fail("Hostname is empty");

  const cert = await new Promise<TlsProbeResult>((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, rejectUnauthorized: true, timeout: 8000 },
      () => {
        const peer = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const names = certNameList(peer);
        const hostMatched = hostnameMatchesCert(host, names);
        const expiresAt = peer.valid_to ? new Date(peer.valid_to).toISOString() : null;
        const expired = expiresAt ? Date.parse(expiresAt) <= Date.now() : true;
        socket.end();
        resolve({
          ok: authorized && hostMatched && !expired,
          authorized,
          subject: cnOf(peer.subject?.CN) || names[0] || "",
          issuer: cnOf(peer.issuer?.CN) || "",
          expiresAt,
          hostMatched,
          statusCode: null,
          error: !authorized
            ? socket.authorizationError
              ? String(socket.authorizationError)
              : "Certificate is not trusted"
            : !hostMatched
              ? "Certificate hostname does not match"
              : expired
                ? "Certificate expired"
                : "",
        });
      },
    );
    socket.on("error", (err) => resolve(fail(err.message || "HTTPS connection failed")));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(fail("HTTPS connection timed out"));
    });
  });
  if (!cert.ok) return cert;

  const statusCode = await new Promise<number | null>((resolve) => {
    const req = https.get(
      originFromHostname(host, true),
      { timeout: 8000, rejectUnauthorized: true, servername: host },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? null);
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
  if (statusCode == null) {
    return { ...cert, ok: false, error: "HTTPS endpoint did not respond" };
  }
  return { ...cert, statusCode, ok: true };
}

export type DnsVerifyInput = {
  hostname: string;
  expectedTxt?: string;
  expectedTxtName?: string;
  systemHost?: string;
  systemIps?: string[];
  production?: boolean;
};

export type DnsVerifyResult = {
  ok: boolean;
  method: "" | "txt" | "cname" | "a";
  actual: string;
  error: string;
  lookup: DnsLookupResult;
};

function flattenTxt(rows: string[][]) {
  return rows.map((parts) => parts.join(""));
}

export async function verifyDnsRecord(
  input: DnsVerifyInput,
  lookup: DnsLookupFn = defaultDnsLookup,
): Promise<DnsVerifyResult> {
  const hostname = normalizeHostname(input.hostname);
  const production = input.production ?? productionDomainContext();
  if (!hostname || !isValidHostname(hostname)) {
    return { ok: false, method: "", actual: "", error: "Hostname is not valid", lookup: emptyLookup() };
  }
  const records = await lookup(hostname);
  const ips = [...records.a, ...records.aaaa];
  if (ips.some((ip) => isBlockedIp(ip, production))) {
    return {
      ok: false,
      method: "",
      actual: ips.join(", "),
      error: "DNS points at a private or internal address",
      lookup: records,
    };
  }

  const expectedTxt = (input.expectedTxt || "").trim();
  if (expectedTxt) {
    const txtHost = normalizeHostname(input.expectedTxtName || txtVerificationName(hostname));
    const txtLookup = txtHost && txtHost !== hostname ? await lookup(txtHost) : records;
    const values = flattenTxt(txtLookup.txt);
    if (values.includes(expectedTxt)) {
      return { ok: true, method: "txt", actual: expectedTxt, error: "", lookup: records };
    }
  }

  const systemHost = normalizeHostname(input.systemHost || "");
  if (systemHost && records.cname.some((c) => c === systemHost || c.endsWith(`.${systemHost}`))) {
    return { ok: true, method: "cname", actual: records.cname[0] || systemHost, error: "", lookup: records };
  }

  const systemIps = (input.systemIps || []).filter(Boolean);
  if (systemHost && !systemIps.length) {
    const sys = await lookup(systemHost);
    systemIps.push(...sys.a, ...sys.aaaa);
  }
  if (systemIps.length && ips.some((ip) => systemIps.includes(ip))) {
    return { ok: true, method: "a", actual: ips.join(", "), error: "", lookup: records };
  }

  if (!ips.length && !records.cname.length) {
    return { ok: false, method: "", actual: "", error: "DNS does not resolve", lookup: records };
  }
  return {
    ok: false,
    method: "",
    actual: [...records.cname, ...ips].join(", "),
    error: expectedTxt ? "Verification TXT record was not found" : "DNS does not point at this platform",
    lookup: records,
  };
}

export async function verifyHttpsCertificate(
  hostname: string,
  probe: TlsProbeFn = defaultTlsProbe,
  opts: { production?: boolean } = {},
): Promise<TlsProbeResult> {
  const host = normalizeHostname(hostname);
  const production = opts.production ?? productionDomainContext();
  if (!host) {
    return {
      ok: false,
      authorized: false,
      subject: "",
      issuer: "",
      expiresAt: null,
      hostMatched: false,
      statusCode: null,
      error: "Hostname is empty",
    };
  }
  if (production && (isLoopbackHostname(host) || isPrivateIpv4(host))) {
    return {
      ok: false,
      authorized: false,
      subject: "",
      issuer: "",
      expiresAt: null,
      hostMatched: false,
      statusCode: null,
      error: "Cannot verify HTTPS for a private hostname",
    };
  }
  return probe(host);
}

export async function lookupSystemIps(systemHost: string, lookup: DnsLookupFn = defaultDnsLookup) {
  const host = normalizeHostname(systemHost);
  if (!host) return [] as string[];
  const rec = await lookup(host);
  return [...rec.a, ...rec.aaaa];
}
