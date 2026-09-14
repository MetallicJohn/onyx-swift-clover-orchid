import { useEffect, useRef, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { accessMethodLabel, formatBytes, formatDateTime } from "@/lib/isp/display";
import { customerTrafficFn } from "@/lib/isp/server-lifecycle";
import { bytesToBps, formatBps, meterPercent, TRAFFIC_POLL_MS, TRAFFIC_SOURCE_LABEL } from "@/lib/isp/traffic-format";

type TrafficSnap = Awaited<ReturnType<typeof customerTrafficFn>>;
type TrafficLine = TrafficSnap["lines"][number];

type Sample = { at: number; bytesIn: number; bytesOut: number };

type Rate = { down: number; up: number };

export function TrafficDrawer({
  open,
  onOpenChange,
  customerId,
  customerName,
  serviceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName?: string;
  serviceId?: string;
}) {
  const [snap, setSnap] = useState<TrafficSnap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState(serviceId || "");
  const [rates, setRates] = useState<Record<string, Rate>>({});
  const prev = useRef<Map<string, Sample>>(new Map());

  useEffect(() => {
    if (serviceId) setFilter(serviceId);
  }, [serviceId]);

  useEffect(() => {
    if (!open) {
      prev.current = new Map();
      setSnap(null);
      setRates({});
      setError(null);
      return;
    }
    let cancelled = false;
    let timer = 0;

    async function tick() {
      try {
        const data = await customerTrafficFn({
          data: { customer_id: customerId, service_id: serviceId || undefined },
        });
        if (cancelled) return;
        const nextRates: Record<string, Rate> = {};
        const now = Date.now();
        for (const line of data.lines) {
          const last = prev.current.get(line.service_id);
          if (line.online && last) {
            nextRates[line.service_id] = {
              down: bytesToBps(last.bytesOut, line.bytes_out, last.at, now),
              up: bytesToBps(last.bytesIn, line.bytes_in, last.at, now),
            };
          }
          if (line.online) {
            prev.current.set(line.service_id, {
              at: now,
              bytesIn: line.bytes_in,
              bytesOut: line.bytes_out,
            });
          } else {
            prev.current.delete(line.service_id);
          }
        }
        setSnap(data);
        setRates(nextRates);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load traffic");
      }
      if (!cancelled) timer = window.setTimeout(tick, TRAFFIC_POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, customerId, serviceId]);

  const lines = (snap?.lines ?? []).filter((l) => !filter || l.service_id === filter);
  const live = lines.filter((l) => l.online);
  const source = snap ? TRAFFIC_SOURCE_LABEL[snap.source] || snap.source : "";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Realtime traffic"
      description={customerName ? `${customerName} · live RADIUS accounting` : "Live RADIUS accounting"}
      className="sm:max-w-xl"
    >
      <div className="grid gap-3">
        {snap && snap.lines.length > 1 && !serviceId ? (
          <Select aria-label="Filter by service" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All services</option>
            {snap.lines.map((l) => (
              <option key={l.service_id} value={l.service_id}>
                {l.package_name} · {accessMethodLabel(l.access_method)} {l.username ? `· ${l.username}` : ""}
              </option>
            ))}
          </Select>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {!snap && !error ? <p className="text-sm text-muted">Reading RADIUS sessions…</p> : null}

        {snap && lines.length === 0 ? (
          <p className="text-sm text-muted">
            {snap.lines.length === 0 ? "This customer has no services." : "No services match that filter."}
          </p>
        ) : null}

        {snap && lines.length > 0 && live.length === 0 ? (
          <p className="rounded-md border border-border bg-elevated px-3 py-3 text-sm">
            No active session. Traffic appears here only while a RADIUS session is online — values are not estimated.
          </p>
        ) : null}

        {lines.map((line) => (
          <TrafficCard key={line.service_id} line={line} rate={rates[line.service_id]} />
        ))}

        {snap ? (
          <p className="text-xs text-subtle">
            Last update {formatDateTime(snap.at)} · Source {source} · Refresh every {TRAFFIC_POLL_MS / 1000}s while
            this panel is open
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function TrafficCard({ line, rate }: { line: TrafficLine; rate?: Rate }) {
  const measuring = line.online && !rate;
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-elevated p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{line.package_name}</div>
          <div className="text-xs text-muted">
            {accessMethodLabel(line.access_method)}
            {line.username ? ` · ${line.username}` : ""}
            {line.framed_ip ? ` · ${line.framed_ip}` : ""}
          </div>
        </div>
        <Badge tone={statusTone(line.online ? "online" : "offline")}>{line.online ? "Online" : "No session"}</Badge>
      </div>
      {line.online ? (
        <>
          <Meter label="Download" bps={rate?.down ?? null} cap={line.download_mbps} measuring={measuring} />
          <Meter label="Upload" bps={rate?.up ?? null} cap={line.upload_mbps} measuring={measuring} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
            <Stat label="Downloaded" value={formatBytes(line.bytes_out)} />
            <Stat label="Uploaded" value={formatBytes(line.bytes_in)} />
            <Stat label="Combined" value={formatBytes(line.bytes_in + line.bytes_out)} />
            <Stat label="Session start" value={formatDateTime(line.started_at)} />
            <Stat label="NAS" value={line.nas_ip || "—"} />
            <Stat label="Framed IP" value={line.framed_ip || "—"} />
          </dl>
        </>
      ) : (
        <p className="text-sm text-muted">Offline. Last known IP {line.framed_ip || "none"}.</p>
      )}
    </div>
  );
}

function Meter({
  label,
  bps,
  cap,
  measuring,
}: {
  label: string;
  bps: number | null;
  cap: number;
  measuring: boolean;
}) {
  const pct = meterPercent(bps, cap);
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-mono tabular-nums">
          {measuring ? "Measuring…" : formatBps(bps)}
          {cap ? <span className="text-xs text-subtle"> / {cap} Mbps</span> : null}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${measuring ? 0 : pct}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className="font-mono text-fg">{value}</dd>
    </div>
  );
}
