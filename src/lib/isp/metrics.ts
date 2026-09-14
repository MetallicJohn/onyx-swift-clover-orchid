type Counter = { n: number; lastMs: number };

const counters = new Map<string, Counter>();
const gauges = new Map<string, number>();

export function metricIncr(name: string, by = 1) {
  const row = counters.get(name) || { n: 0, lastMs: 0 };
  row.n += by;
  row.lastMs = Date.now();
  counters.set(name, row);
}

export function metricSet(name: string, value: number) {
  gauges.set(name, value);
}

export function metricSnapshot() {
  const out: Record<string, number> = {};
  for (const [k, v] of counters) out[k] = v.n;
  for (const [k, v] of gauges) out[k] = v;
  return out;
}

export function resetMetricsForTests() {
  counters.clear();
  gauges.clear();
}
