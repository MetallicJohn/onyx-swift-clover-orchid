import { nid } from "../utils.ts";
import { initialCommandStatus } from "./command-policy";
import { ensureOpsSchema } from "./ops-schema";
import { applyRls } from "./rls";
import { commandRosScript, wrapPullRosScript } from "./routeros";
import { pcqFromPayload } from "./pcq";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type RestOp = {
  method: "GET" | "PUT" | "PATCH" | "DELETE" | "POST";
  path: string;
  body?: Record<string, string>;
};

export type CompiledCommand = {
  id: string;
  kind: string;
  rest: RestOp[];
  script: string;
  payload: Record<string, unknown>;
};

function nameOf(payload: Record<string, unknown>) {
  return String(payload.username || payload.name || "").trim();
}

function pcqRestOps(payload: Record<string, unknown>): RestOp[] {
  const p = pcqFromPayload(payload);
  const qspec = `${p.upType}/${p.downType}`;
  return [
    {
      method: "PUT",
      path: "/rest/queue/type",
      body: {
        name: p.upType,
        kind: "pcq",
        "pcq-rate": p.upRate,
        "pcq-classifier": "src-address",
        "pcq-limit": "50",
        "pcq-total-limit": "20000",
      },
    },
    {
      method: "PUT",
      path: "/rest/queue/type",
      body: {
        name: p.downType,
        kind: "pcq",
        "pcq-rate": p.downRate,
        "pcq-classifier": "dst-address",
        "pcq-limit": "50",
        "pcq-total-limit": "20000",
      },
    },
    {
      method: "PUT",
      path: "/rest/ppp/profile",
      body: { name: p.profile, queue: qspec, comment: "isp-pcq" },
    },
    {
      method: "PUT",
      path: "/rest/ip/hotspot/user-profile",
      body: { name: p.profile, "address-list": p.list, "rate-limit": "", comment: "isp-pcq" },
    },
    {
      method: "PUT",
      path: "/rest/ip/firewall/mangle",
      body: {
        chain: "forward",
        action: "mark-packet",
        "new-packet-mark": p.markUp,
        passthrough: "no",
        "src-address-list": p.list,
        comment: p.commentUp,
      },
    },
    {
      method: "PUT",
      path: "/rest/ip/firewall/mangle",
      body: {
        chain: "forward",
        action: "mark-packet",
        "new-packet-mark": p.markDown,
        passthrough: "no",
        "dst-address-list": p.list,
        comment: p.commentDown,
      },
    },
    {
      method: "PUT",
      path: "/rest/queue/tree",
      body: { name: p.treeUp, parent: "global", queue: p.upType, "packet-mark": p.markUp, comment: "isp-pcq" },
    },
    {
      method: "PUT",
      path: "/rest/queue/tree",
      body: { name: p.treeDown, parent: "global", queue: p.downType, "packet-mark": p.markDown, comment: "isp-pcq" },
    },
  ];
}

export function compileMikrotik(kind: string, payload: Record<string, unknown>): { rest: RestOp[]; script: string } {
  const user = nameOf(payload);
  const password = String(payload.password || "changeme");
  const ip = String(payload.static_ip || payload.address || "");
  const profile = pcqFromPayload(payload).profile;
  const list = pcqFromPayload(payload).list;
  const disabled = payload.status === "suspended" || payload.status === "terminated" || payload.enabled === false;
  const script = commandRosScript(kind, payload);

  if (kind === "package.sync") {
    return { rest: pcqRestOps(payload), script };
  }

  if (kind.startsWith("pppoe.")) {
    if (!user) return { rest: [], script };
    if (kind.endsWith("disconnect")) {
      return { rest: [{ method: "DELETE", path: `/rest/ppp/active/${encodeURIComponent(user)}` }], script };
    }
    if (kind.endsWith("disable") || disabled) {
      return {
        rest: [
          { method: "PATCH", path: `/rest/ppp/secret/${encodeURIComponent(user)}`, body: { disabled: "true" } },
          { method: "DELETE", path: `/rest/ppp/active/${encodeURIComponent(user)}` },
        ],
        script,
      };
    }
    return {
      rest: [
        ...pcqRestOps(payload),
        {
          method: "PUT",
          path: "/rest/ppp/secret",
          body: {
            name: user,
            password,
            service: "pppoe",
            profile,
            disabled: "false",
            comment: String(payload.service_id || "gridline"),
          },
        },
      ],
      script,
    };
  }

  if (kind.startsWith("static.")) {
    const qname = `static-${user || ip || "host"}`;
    if (kind.endsWith("disable") || disabled) {
      return {
        rest: [
          { method: "DELETE", path: `/rest/queue/simple/${encodeURIComponent(qname)}` },
          { method: "DELETE", path: `/rest/ip/firewall/address-list/${encodeURIComponent(ip)}` },
        ],
        script,
      };
    }
    return {
      rest: [
        ...pcqRestOps(payload),
        { method: "DELETE", path: `/rest/queue/simple/${encodeURIComponent(qname)}` },
        {
          method: "PUT",
          path: "/rest/ip/firewall/address-list",
          body: { list, address: ip, comment: user },
        },
        {
          method: "PUT",
          path: "/rest/ip/firewall/address-list",
          body: { list: "gridline-active", address: ip, comment: user },
        },
      ],
      script,
    };
  }

  if (kind.startsWith("hotspot.")) {
    if (!user) return { rest: [], script };
    if (kind.endsWith("disconnect")) {
      return { rest: [{ method: "DELETE", path: `/rest/ip/hotspot/active/${encodeURIComponent(user)}` }], script };
    }
    if (kind.endsWith("disable") || disabled) {
      return {
        rest: [{ method: "PATCH", path: `/rest/ip/hotspot/user/${encodeURIComponent(user)}`, body: { disabled: "true" } }],
        script,
      };
    }
    return {
      rest: [
        ...pcqRestOps(payload),
        {
          method: "PUT",
          path: "/rest/ip/hotspot/user",
          body: { name: user, password, profile, disabled: "false" },
        },
      ],
      script,
    };
  }

  if (kind === "identity.set") {
    const identity = String(payload.identity || payload.name || "gridline");
    return {
      rest: [{ method: "POST", path: "/rest/system/identity/set", body: { name: identity } }],
      script,
    };
  }

  if (kind === "resource.snapshot") {
    return { rest: [{ method: "GET", path: "/rest/system/resource" }], script };
  }

  if (kind === "raw.script") {
    return { rest: [], script };
  }

  if (kind === "reboot") {
    return { rest: [{ method: "POST", path: "/rest/system/reboot" }], script };
  }

  return { rest: [], script };
}

export function compileRow(id: string, kind: string, payloadRaw: string): CompiledCommand {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(payloadRaw || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const compiled = compileMikrotik(kind, payload);
  return { id, kind, rest: compiled.rest, script: compiled.script, payload };
}

async function routerByToken(sql: Sql, token: string) {
  const t = token.trim();
  if (!t) return null;
  await applyRls(sql, { bypass: true });
  const [r] = await sql<{
    id: string;
    tenant_id: string;
    name: string;
    identity: string;
    enroll_token: string;
    wg_address: string;
    api_user: string;
    api_password: string;
    api_port: number;
    api_host: string;
  }>`select id, tenant_id, name, identity, enroll_token, wg_address, api_user, api_password, api_port, api_host
     from routers where enroll_token = ${t}`;
  if (r) await applyRls(sql, { tenantId: r.tenant_id, bypass: false });
  return r ?? null;
}

export async function pullCommands(sql: Sql, token: string, markSent = true) {
  await ensureOpsSchema(sql);
  const router = await routerByToken(sql, token);
  if (!router) throw new Error("Unknown enroll token");
  await sql`update routers set wg_status = 'connected', last_seen = now() where id = ${router.id}`;
  const rows = await sql<{ id: string; kind: string; payload: string }>`
    select id, kind, payload from agent_commands
    where router_id = ${router.id} and status = 'queued'
    order by created_at asc limit 40`;
  const commands = rows.map((row) => compileRow(row.id, row.kind, row.payload));
  if (markSent) {
    for (const c of commands) {
      await sql`update agent_commands set status = 'sent' where id = ${c.id}`;
    }
  }
  return { router: { id: router.id, name: router.name, identity: router.identity, wg_address: router.wg_address }, commands };
}

export async function renderAgentScript(sql: Sql, token: string) {
  const pulled = await pullCommands(sql, token, true);
  const script = wrapPullRosScript({
    identity: pulled.router.identity || pulled.router.name,
    commands: pulled.commands.map((c) => ({ id: c.id, kind: c.kind, script: c.script })),
  });
  const ids = pulled.commands.map((c) => c.id).join(",");
  return { script, ids, router: pulled.router };
}

export async function ackCommands(sql: Sql, token: string, ids: string[], result = "ok") {
  await ensureOpsSchema(sql);
  const router = await routerByToken(sql, token);
  if (!router) throw new Error("Unknown enroll token");
  for (const id of ids) {
    if (!id) continue;
    await sql`update agent_commands set status = 'acked', acked_at = now(), result = ${result.slice(0, 2000)}
      where id = ${id} and router_id = ${router.id}`;
  }
  return { ok: true, acked: ids.length };
}

export async function heartbeatRouter(
  sql: Sql,
  token: string,
  stats?: { cpu?: number; uptime_hours?: number; version?: string },
) {
  await ensureOpsSchema(sql);
  const router = await routerByToken(sql, token);
  if (!router) throw new Error("Unknown enroll token");
  await sql`update routers set
    wg_status = 'connected',
    last_seen = now(),
    cpu_pct = ${stats?.cpu ?? 8},
    uptime_hours = ${stats?.uptime_hours ?? 1},
    agent_version = ${stats?.version || "0.2.0"}
    where id = ${router.id}`;
  return { ok: true, router_id: router.id };
}

export async function executeRestOps(
  host: string,
  user: string,
  password: string,
  port: number,
  ops: RestOp[],
) {
  const root = host.replace(/\/$/, "");
  const base = root.startsWith("http") ? root : `https://${root}:${port || 443}`;
  const auth = Buffer.from(`${user}:${password}`).toString("base64");
  const results: { path: string; status: number; body: string }[] = [];
  for (const op of ops) {
    const res = await fetch(`${base}${op.path}`, {
      method: op.method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: op.body ? JSON.stringify(op.body) : undefined,
    });
    results.push({ path: op.path, status: res.status, body: (await res.text()).slice(0, 400) });
  }
  return results;
}

export function curlForOps(host: string, user: string, ops: RestOp[]) {
  const base = host.replace(/\/$/, "") || "https://10.200.0.2";
  return ops
    .map((op) => {
      const body = op.body ? ` \\\n  --data '${JSON.stringify(op.body)}'` : "";
      return `curl -k -u ${user}:**** -X ${op.method} ${base}${op.path}${body}`;
    })
    .join("\n\n");
}

export async function queueCompiledCommand(
  sql: Sql,
  tenantId: string,
  routerId: string,
  kind: string,
  payload: Record<string, unknown>,
  requestedBy = "",
) {
  await ensureOpsSchema(sql);
  const id = nid("cmd");
  const status = initialCommandStatus(kind);
  await sql`insert into agent_commands (id, tenant_id, router_id, kind, payload, status, requested_by)
    values (${id}, ${tenantId}, ${routerId}, ${kind}, ${JSON.stringify(payload)}, ${status}, ${requestedBy})`;
  return { id, status, ...compileMikrotik(kind, payload) };
}

export async function approveCommand(sql: Sql, tenantId: string, commandId: string, userId: string) {
  const [cmd] = await sql<{ id: string; status: string; kind: string }>`
    select id, status, kind from agent_commands where id = ${commandId} and tenant_id = ${tenantId}`;
  if (!cmd) throw new Error("Command not found");
  if (cmd.status !== "proposed") throw new Error("Only proposed commands can be approved");
  await sql`update agent_commands set status = 'queued', approved_by = ${userId}
    where id = ${cmd.id} and tenant_id = ${tenantId}`;
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${`command.approved:${cmd.kind}`}, 'agent_command', ${cmd.id})`;
  return { ok: true, id: cmd.id };
}
