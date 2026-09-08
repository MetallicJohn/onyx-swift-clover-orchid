const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, max = 60, windowMs = 60_000) {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || row.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }
  if (row.n >= max) return { ok: false, remaining: 0 };
  row.n += 1;
  return { ok: true, remaining: max - row.n };
}
