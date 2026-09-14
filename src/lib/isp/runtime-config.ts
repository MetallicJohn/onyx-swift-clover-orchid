/**
 * Validated service endpoints. Compose/env files name hosts; this module never
 * invents localhost or Docker DNS in production.
 */
export type AppEnv = "preview" | "production";

export const JOB_QUEUES = [
  "billing",
  "notifications",
  "payments",
  "radius",
  "mikrotik",
  "genieacs",
  "traffic",
  "reports",
  "maintenance",
] as const;

export type JobQueueName = (typeof JOB_QUEUES)[number];

function raw(key: string, env: NodeJS.ProcessEnv = process.env) {
  const v = env[key];
  return typeof v === "string" ? v.trim() : "";
}

/** Prefer the ISP Solutions key; accept a previous key so existing env files keep working. */
export function envValue(env: NodeJS.ProcessEnv, primary: string, previous?: string) {
  return raw(primary, env) || (previous ? raw(previous, env) : "");
}


export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production" || Boolean((env.DATABASE_URL || "").trim());
}

export function appEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  return isProductionRuntime(env) ? "production" : "preview";
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|::1)$/i;

export function parseHttpUrl(value: string, label: string, opts: { allowEmpty?: boolean } = {}) {
  const v = (value || "").trim().replace(/\/+$/, "");
  if (!v) {
    if (opts.allowEmpty) return "";
    throw new ConfigError(`${label} is required`);
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ConfigError(`${label} must be an http(s) URL`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ConfigError(`${label} must be http or https`);
  }
  return v;
}

export function assertNotLoopbackHost(url: string, label: string, production: boolean) {
  if (!url || !production) return;
  try {
    const host = new URL(url).hostname;
    if (LOOPBACK.test(host)) {
      throw new ConfigError(`${label} cannot be localhost in production — set the private service address`);
    }
  } catch (err) {
    if (err instanceof ConfigError) throw err;
  }
}

export function parseIntEnv(value: string, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function parseBoolEnv(value: string, fallback = false) {
  if (!value) return fallback;
  const v = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

export type DatabaseSslMode = "disable" | "require" | "verify-full";

export function parseDatabaseSslMode(rawMode: string): DatabaseSslMode {
  const v = (rawMode || "").trim().toLowerCase();
  if (v === "disable" || v === "false" || v === "0") return "disable";
  if (v === "verify-full" || v === "verify_full") return "verify-full";
  if (v === "require" || v === "true" || v === "1") return "require";
  return "disable";
}

export type ServiceConfig = {
  env: AppEnv;
  appUrl: string;
  internalUrl: string;
  secretPresent: boolean;
  databaseUrl: string;
  databasePoolMin: number;
  databasePoolMax: number;
  databaseSslMode: DatabaseSslMode;
  databaseConnectTimeoutMs: number;
  redisUrl: string;
  redisPasswordSet: boolean;
  redisTls: boolean;
  radiusHost: string;
  radiusAuthPort: number;
  radiusAcctPort: number;
  radiusCoaPort: number;
  radiusDisconnectPort: number;
  radiusSecretSet: boolean;
  genieacsNbiUrl: string;
  genieacsNbiUser: string;
  genieacsNbiPassSet: boolean;
  genieacsCwmpUrl: string;
  genieacsTimeoutMs: number;
  mongodbUrl: string;
  mongodbDatabase: string;
  trafficCollectorUrl: string;
  trafficCollectorKeySet: boolean;
  trafficIntervalSec: number;
  mikrotikTimeoutMs: number;
  wireguardEndpoint: string;
  wireguardApiUrl: string;
  workerConcurrency: number;
  jobQueueName: string;
  logLevel: string;
  metricsEnabled: boolean;
  healthcheckTokenSet: boolean;
  internalTokenSet: boolean;
};

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const production = isProductionRuntime(env);
  const mode: AppEnv = production ? "production" : "preview";
  const secret = (env.APP_SECRET || env.BETTER_AUTH_SECRET || "").trim();
  if (production && !secret) {
    throw new ConfigError("APP_SECRET or BETTER_AUTH_SECRET is required");
  }

  const nbi = parseHttpUrl(env.GENIEACS_NBI_URL || "", "GENIEACS_NBI_URL", { allowEmpty: true });
  const cwmp = parseHttpUrl(env.GENIEACS_CWMP_URL || "", "GENIEACS_CWMP_URL", { allowEmpty: true });
  const internal = parseHttpUrl(
    envValue(env, "ISPSOLUTIONS_INTERNAL_URL", "GRIDLINE_INTERNAL_URL") || env.APP_URL || "",
    "ISPSOLUTIONS_INTERNAL_URL",
    { allowEmpty: true },
  );
  const appUrl = parseHttpUrl(env.APP_URL || env.BETTER_AUTH_URL || "", "APP_URL", { allowEmpty: true });
  const redis = (env.REDIS_URL || "").trim();
  const collector = parseHttpUrl(env.TRAFFIC_COLLECTOR_URL || "", "TRAFFIC_COLLECTOR_URL", { allowEmpty: true });
  const mongo = (env.MONGODB_URL || env.MONGO_URL || "").trim();
  const radiusHost = (env.RADIUS_HOST || "").trim();

  if (production) {
    assertNotLoopbackHost(nbi, "GENIEACS_NBI_URL", true);
    assertNotLoopbackHost(cwmp, "GENIEACS_CWMP_URL", true);
    assertNotLoopbackHost(internal, "ISPSOLUTIONS_INTERNAL_URL", true);
    assertNotLoopbackHost(collector, "TRAFFIC_COLLECTOR_URL", true);
    if (redis) {
      try {
        const u = new URL(redis);
        if (LOOPBACK.test(u.hostname)) {
          throw new ConfigError("REDIS_URL cannot be localhost in production — set the private Redis address");
        }
      } catch (err) {
        if (err instanceof ConfigError) throw err;
        throw new ConfigError("REDIS_URL is not a valid URL");
      }
    }
  }

  return {
    env: mode,
    appUrl,
    internalUrl: internal,
    secretPresent: Boolean(secret),
    databaseUrl: (env.DATABASE_URL || "").trim(),
    databasePoolMin: parseIntEnv(env.DATABASE_POOL_MIN || "", 0, 0, 32),
    databasePoolMax: parseIntEnv(env.DATABASE_POOL_MAX || "", 10, 1, 100),
    databaseSslMode: parseDatabaseSslMode(env.DATABASE_SSL_MODE || ""),
    databaseConnectTimeoutMs: parseIntEnv(env.DATABASE_CONNECT_TIMEOUT_MS || "", 8_000, 500, 60_000),
    redisUrl: redis,
    redisPasswordSet: Boolean((env.REDIS_PASSWORD || "").trim() || (redis.includes("@") && redis.includes(":"))),
    redisTls: parseBoolEnv(env.REDIS_TLS || "", false) || redis.startsWith("rediss://"),
    radiusHost,
    radiusAuthPort: parseIntEnv(env.RADIUS_AUTH_PORT || "", 1812, 1, 65535),
    radiusAcctPort: parseIntEnv(env.RADIUS_ACCOUNTING_PORT || env.RADIUS_ACCT_PORT || "", 1813, 1, 65535),
    radiusCoaPort: parseIntEnv(env.RADIUS_COA_PORT || "", 3799, 1, 65535),
    radiusDisconnectPort: parseIntEnv(env.RADIUS_DISCONNECT_PORT || "", 3799, 1, 65535),
    radiusSecretSet: Boolean((env.RADIUS_SECRET || env.RADIUS_NAS_SECRET || "").trim()),
    genieacsNbiUrl: nbi,
    genieacsNbiUser: (env.GENIEACS_NBI_USER || env.GENIEACS_NBI_USERNAME || "").trim(),
    genieacsNbiPassSet: Boolean((env.GENIEACS_NBI_PASS || env.GENIEACS_NBI_PASSWORD || "").trim()),
    genieacsCwmpUrl: cwmp,
    genieacsTimeoutMs: parseIntEnv(env.GENIEACS_TIMEOUT_MS || "", 8_000, 500, 60_000),
    mongodbUrl: mongo,
    mongodbDatabase: (env.MONGODB_DATABASE || "genieacs").trim() || "genieacs",
    trafficCollectorUrl: collector,
    trafficCollectorKeySet: Boolean((env.TRAFFIC_COLLECTOR_API_KEY || "").trim()),
    trafficIntervalSec: parseIntEnv(env.TRAFFIC_COLLECTION_INTERVAL || "", 30, 5, 3600),
    mikrotikTimeoutMs: parseIntEnv(env.MIKROTIK_API_TIMEOUT || "", 4_000, 500, 30_000),
    wireguardEndpoint: (env.WIREGUARD_ENDPOINT || "").trim(),
    wireguardApiUrl: parseHttpUrl(env.WIREGUARD_API_URL || "", "WIREGUARD_API_URL", { allowEmpty: true }),
    workerConcurrency: parseIntEnv(env.WORKER_CONCURRENCY || "", 2, 1, 32),
    jobQueueName: (env.JOB_QUEUE_NAME || "").trim(),
    logLevel: (env.LOG_LEVEL || "info").trim().toLowerCase() || "info",
    metricsEnabled: parseBoolEnv(env.METRICS_ENABLED || "", mode === "production"),
    healthcheckTokenSet: Boolean((env.HEALTHCHECK_TOKEN || "").trim()),
    internalTokenSet: Boolean((env.INTERNAL_SERVICE_TOKEN || env.ACS_EDGE_TOKEN || "").trim()),
  };
}

export function postgresPoolOptions(cfg: ServiceConfig) {
  const ssl =
    cfg.databaseSslMode === "disable"
      ? undefined
      : cfg.databaseSslMode === "verify-full"
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false };
  return {
    max: cfg.databasePoolMax,
    connectionTimeoutMillis: cfg.databaseConnectTimeoutMs,
    idleTimeoutMillis: 30_000,
    ssl,
  };
}

export function genieacsFromEnv(cfg: ServiceConfig = loadServiceConfig()) {
  return {
    nbiUrl: cfg.genieacsNbiUrl,
    user: cfg.genieacsNbiUser,
    pass: raw("GENIEACS_NBI_PASS") || raw("GENIEACS_NBI_PASSWORD"),
    timeoutMs: cfg.genieacsTimeoutMs,
    cwmpUrl: cfg.genieacsCwmpUrl,
  };
}

export function radiusNasTarget(cfg: ServiceConfig = loadServiceConfig()) {
  return {
    host: cfg.radiusHost,
    authPort: cfg.radiusAuthPort,
    acctPort: cfg.radiusAcctPort,
    coaPort: cfg.radiusCoaPort,
    disconnectPort: cfg.radiusDisconnectPort,
    configured: Boolean(cfg.radiusHost),
  };
}

export function internalAppUrl(cfg: ServiceConfig = loadServiceConfig(), fallbackPublic = "") {
  if (cfg.internalUrl) return cfg.internalUrl;
  const pub = (fallbackPublic || "").trim().replace(/\/+$/, "");
  if (pub) return pub;
  if (cfg.env === "production") return "";
  return "";
}
