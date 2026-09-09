export function mikrotikRateLimit(downMbps: number, upMbps: number) {
  return `${Math.max(1, upMbps)}M/${Math.max(1, downMbps)}M`;
}

export function renderFreeRadiusUsers(
  accounts: Array<{ username: string; password: string; framed_ip: string; group_name: string; enabled: boolean; rate_limit: string }>,
) {
  return accounts
    .map((a) => {
      if (!a.enabled) {
        return `${a.username} Auth-Type := Reject`;
      }
      const attrs = [`Cleartext-Password := "${a.password}"`];
      if (a.rate_limit) attrs.push(`Mikrotik-Rate-Limit := "${a.rate_limit}"`);
      if (a.framed_ip) attrs.push(`Framed-IP-Address := ${a.framed_ip}`);
      attrs.push(`Mikrotik-Group := "${a.group_name}"`);
      return `${a.username} ${attrs[0]}\n\t${attrs.slice(1).join(",\n\t")}`;
    })
    .join("\n\n");
}

export function publicRadiusAccount<T extends { password: string }>(row: T) {
  const p = row.password;
  const shown = !p ? "" : p.length <= 4 ? "••••" : `••••${p.slice(-4)}`;
  return { ...row, password: shown };
}

export function radiusUsername(raw: string) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (s.includes("@")) return s.split("@")[0] || s;
  if (s.includes("\\")) return s.split("\\").pop() || s;
  return s;
}

export function restAttr(value: string | number, op = ":=") {
  return { op, value: [String(value)] };
}

export function attrValue(body: unknown, name: string): string {
  if (!body || typeof body !== "object") return "";
  const rec = body as Record<string, unknown>;
  const aliases = [name, name.replace(/-/g, "_"), name.replace(/-/g, "")];
  if (name === "User-Name") aliases.push("username");
  if (name === "User-Password") aliases.push("password");
  if (name === "NAS-IP-Address") aliases.push("nas_ip", "NAS-IP");
  if (name === "Framed-IP-Address") aliases.push("framed_ip");
  if (name === "Acct-Session-Id") aliases.push("session_id", "Acct-Session-ID");
  if (name === "Acct-Status-Type") aliases.push("acct_status");
  if (name === "Acct-Input-Octets") aliases.push("bytes_in");
  if (name === "Acct-Output-Octets") aliases.push("bytes_out");
  for (const key of aliases) {
    if (!(key in rec)) continue;
    const raw = rec[key];
    if (raw == null) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return String(raw);
    if (typeof raw === "object" && raw !== null && "value" in raw) {
      const v = (raw as { value: unknown }).value;
      if (Array.isArray(v)) return v[0] == null ? "" : String(v[0]);
      if (v == null) continue;
      return String(v);
    }
  }
  return "";
}

export function octetsFromAvps(body: unknown, direction: "Input" | "Output") {
  const octets = Number(attrValue(body, `Acct-${direction}-Octets`)) || 0;
  const giga = Number(attrValue(body, `Acct-${direction}-Gigawords`)) || 0;
  const simple = direction === "Input" ? Number(attrValue(body, "bytes_in")) || 0 : Number(attrValue(body, "bytes_out")) || 0;
  const base = octets || simple;
  return Math.max(0, Math.floor(base + giga * 4294967296));
}

export function parseAcctStatus(raw: string): "start" | "stop" | "interim" {
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "start") return "start";
  if (v === "2" || v === "stop") return "stop";
  if (v === "3" || v === "interim-update" || v === "interim" || v === "alive") return "interim";
  return "interim";
}

export function renderFreeRadiusRestMod(opts: { baseUrl: string; slug: string; apiKey: string }) {
  const root = (opts.baseUrl || "https://gridline.example").replace(/\/$/, "");
  const slug = opts.slug || "your-isp";
  const key = opts.apiKey || "frk_replace_me";
  return `rest {
    connect_uri = "${root}"
    username = "gridline"
    password = "${key}"

    authorize {
        uri = "${root}/api/v1/radius/authorize/${slug}"
        method = 'post'
        body = 'json'
    }
    authenticate {
        uri = "${root}/api/v1/radius/authenticate/${slug}"
        method = 'post'
        body = 'json'
    }
    accounting {
        uri = "${root}/api/v1/radius/accounting/${slug}"
        method = 'post'
        body = 'json'
    }
}
`;
}

export function renderFreeRadiusSite() {
  return `server gridline {
    listen {
        type = auth
        ipaddr = *
        port = 1812
    }
    listen {
        type = acct
        ipaddr = *
        port = 1813
    }

    authorize {
        filter_username
        preprocess
        rest
        pap
        chap
        mschap
    }

    authenticate {
        Auth-Type PAP {
            pap
        }
        Auth-Type CHAP {
            chap
        }
        Auth-Type MS-CHAP {
            mschap
        }
        Auth-Type REST {
            rest
        }
    }

    accounting {
        rest
    }

    post-auth {
        Post-Auth-Type REJECT {
            attr_filter.access_reject
        }
    }
}
`;
}

export function renderRadiusClientsConf(
  clients: Array<{ name: string; ip: string; secret: string }>,
) {
  const rows =
    clients.length > 0
      ? clients
      : [{ name: "mikrotik-1", ip: "10.200.0.2", secret: "change-me-on-the-router" }];
  return rows
    .map(
      (c) => `client ${c.name.replace(/[^A-Za-z0-9_-]/g, "-") || "nas"} {
    ipaddr = ${c.ip || "10.200.0.2"}
    secret = ${c.secret || "change-me-on-the-router"}
    shortname = ${c.name.replace(/[^A-Za-z0-9_-]/g, "-") || "nas"}
    nas_type = other
}
`,
    )
    .join("\n");
}

export function renderMikrotikRadiusSnippet(opts: { radiusHost: string; secret: string }) {
  const host = opts.radiusHost || "10.200.0.1";
  const secret = opts.secret || "change-me-on-the-router";
  return `/radius add address=${host} secret=${secret} service=ppp,hotspot,login timeout=300ms
/ppp aaa set use-radius=yes accounting=yes interim-update=5m
/ip hotspot profile set [find] use-radius=yes`;
}
