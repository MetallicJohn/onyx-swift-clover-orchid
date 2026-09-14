import { getSql } from "../db";
import { jobHealth } from "./jobs.ts";
import { nbiPing, type AcsNbiConfig } from "./acs-nbi.ts";
import { genieacsFromEnv, loadServiceConfig, radiusNasTarget } from "./runtime-config.ts";
import { redisHealth } from "./redis.ts";
import { collectorHealth } from "./traffic-collector.ts";
import { httpProbe, parseHostPort, tcpProbe, type Probe } from "./probes.ts";
import { metricSnapshot } from "./metrics.ts";
import { internalToken } from "./internal-auth.ts";

export type HealthReport = {
  ok: boolean;
  ready: boolean;
  degraded: boolean;
  service: string;
  role: string;
  sha: string;
  checks: Record<string, Probe & Record<string, unknown>>;
  metrics: Record<string, number>;
};

function notConfigured(): Probe {
  return { status: "not_configured" };
}

async function databaseCheck(): Promise<Probe> {
  const started = Date.now();
  try {
    const sql = await getSql();
    await sql`select 1 as ok`;
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }
}

async function genieacsCheck(cfg: AcsNbiConfig): Promise<Probe> {
  if (!cfg.nbiUrl) return notConfigured();
  const started = Date.now();
  const ping = await nbiPing({ ...cfg, timeoutMs: 2000 });
  if (ping.ok) return { status: "ok", latencyMs: Date.now() - started };
  return {
    status: "error",
    detail: ("error" in ping ? ping.error : `NBI HTTP ${ping.status}`) || "nbi unavailable",
    latencyMs: Date.now() - started,
  };
}

export async function buildHealthReport(kind: "live" | "ready" = "live"): Promise<HealthReport> {
  const cfg = loadServiceConfig();
  const role = process.env.ROLE || "web";
  const database = await databaseCheck();
  const redis: Probe = await redisHealth()
    .then((r) => ({
      status: (r.configured ? (r.ok ? "ok" : "error") : "not_configured") as Probe["status"],
      detail: r.kind,
    }))
    .catch((err) => ({ status: "error" as const, detail: err instanceof Error ? err.message : String(err) }));

  const acs = await genieacsCheck({
    nbiUrl: genieacsFromEnv(cfg).nbiUrl,
    user: genieacsFromEnv(cfg).user,
    pass: genieacsFromEnv(cfg).pass,
    oui: "",
  });

  const mongoUrl = cfg.mongodbUrl;
  const mongo =
    mongoUrl
      ? await tcpProbe(parseHostPort(mongoUrl, 27017).host, parseHostPort(mongoUrl, 27017).port)
      : notConfigured();

  const radiusTarget = radiusNasTarget(cfg);
  const radius = radiusTarget.configured
    ? { status: "ok" as const, detail: `${radiusTarget.host}:${radiusTarget.authPort}` }
    : notConfigured();

  const wg = cfg.wireguardEndpoint
    ? { status: "ok" as const, detail: cfg.wireguardEndpoint }
    : notConfigured();

  let jobs = { queued: 0, running: 0, failed: 0, dead: 0 };
  let traffic: Probe & { last_ok_at?: string | null } = notConfigured();
  if (database.status === "ok") {
    try {
      const sql = await getSql();
      jobs = await jobHealth(sql);
      const col = await collectorHealth(sql);
      traffic = { status: col.status, last_ok_at: col.last_ok_at };
    } catch (err) {
      traffic = { status: "error", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  const collectorUrl = cfg.trafficCollectorUrl;
  const remoteCollector = collectorUrl
    ? await httpProbe(
        `${collectorUrl.replace(/\/+$/, "")}/health`,
        3000,
        internalToken() ? { authorization: `Bearer ${internalToken()}` } : {},
      )
    : notConfigured();

  const checks: HealthReport["checks"] = {
    database,
    redis,
    genieacs: acs,
    mongodb: mongo,
    radius,
    traffic,
    collector: remoteCollector,
    jobs: {
      status: jobs.dead > 0 ? "degraded" : "ok",
      queued: jobs.queued,
      running: jobs.running,
      failed: jobs.failed,
      dead: jobs.dead,
    },
    wireguard: wg,
  };

  const ready = database.status === "ok";
  const degraded =
    redis.status === "error" ||
    acs.status === "error" ||
    traffic.status === "error" ||
    traffic.status === "stale" ||
    jobs.dead > 0;
  return {
    ok: kind === "live" ? true : ready,
    ready,
    degraded,
    service: "ispsolutions-web",
    role,
    sha: process.env.GRIDLINE_GIT_SHA || "",
    checks,
    metrics: metricSnapshot(),
  };
}

export function healthcheckAuthorized(request: Request) {
  const token = (process.env.HEALTHCHECK_TOKEN || "").trim();
  if (!token) return true;
  const header = request.headers.get("authorization") || "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (request.headers.get("x-healthcheck-token") || "").trim();
  return presented === token;
}
