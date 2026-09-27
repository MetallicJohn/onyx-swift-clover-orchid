const hits = new Map<string, { n: number; reset: number }>();
let checks = 0;

function prune(now: number) {
  checks += 1;
  if (checks % 32 !== 0 && hits.size < 1024) return;
  for (const [key, row] of hits) {
    if (row.reset <= now) hits.delete(key);
  }
}

function localHit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  prune(now);
  const row = hits.get(key);
  if (!row || row.reset <= now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { ok: true, remaining: Math.max(0, max - 1) };
  }
  if (row.n >= max) return { ok: false, remaining: 0 };
  row.n += 1;
  return { ok: true, remaining: Math.max(0, max - row.n) };
}

export function rateLimitCacheSize() {
  return hits.size;
}

/** Fixed window. Uses Redis INCR+TTL when configured so every instance shares the limit. */
export async function rateLimit(key: string, max = 60, windowMs = 60_000) {
  const id = key.slice(0, 180);
  try {
    const { getRedis } = await import("./redis.ts");
    const redis = getRedis();
    if (redis.configured && redis.incr) {
      const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
      const n = await redis.incr(`rl:${id}`, ttlSec);
      if (Number.isFinite(n) && n > 0) return { ok: n <= max, remaining: Math.max(0, max - n) };
    }
  } catch {
    /* redis down: this process still limits */
  }
  return localHit(id, max, windowMs);
}
