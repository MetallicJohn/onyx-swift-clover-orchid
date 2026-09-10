import type { ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl bg-surface p-5 shadow-card md:p-6", className)}>{children}</section>;
}

export function PageHead({
  eyebrow,
  title,
  hint,
  actions,
}: {
  eyebrow?: string;
  title: string;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="mb-1 text-xs font-medium uppercase tracking-wider text-subtle">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {hint ? <p className="mt-1 max-w-2xl text-sm text-muted">{hint}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "ok" | "warn" | "danger" | "muted";
}) {
  return (
    <div className="rounded-xl bg-surface p-5 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div
        className={cn(
          "mt-2 font-mono text-2xl font-semibold tracking-tight",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label?: string }) {
  const unlimited = max <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  const tone = unlimited ? "bg-accent" : pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warn" : "bg-accent";
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono">{unlimited ? `${value} / unlimited` : `${value} / ${max}`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${unlimited ? 8 : pct}%` }} />
      </div>
    </div>
  );
}

export function HealthDot({ health }: { health: string }) {
  const tone =
    health === "healthy"
      ? "ok"
      : health === "warning"
        ? "warn"
        : health === "critical" || health === "offline"
          ? "danger"
          : "muted";
  const label =
    health === "healthy"
      ? "Healthy"
      : health === "warning"
        ? "Warning"
        : health === "critical"
          ? "Critical"
          : health === "offline"
            ? "Offline"
            : health === "none"
              ? "No nodes"
              : "Telemetry unavailable";
  return <Badge tone={tone}>{label}</Badge>;
}

export function StatusPill({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replaceAll("_", " ")}</Badge>;
}

export function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted">{text}</p>;
}

export function Telemetry({ value, unit }: { value: number | null | undefined; unit?: string }) {
  if (value == null) return <span className="text-muted">Telemetry unavailable</span>;
  return (
    <span className="font-mono">
      {value}
      {unit || ""}
    </span>
  );
}

export function Spark({
  points,
  color = "var(--color-accent)",
}: {
  points: { x: string; y: number }[];
  color?: string;
}) {
  if (points.length === 0) return <div className="h-24 rounded-md bg-elevated/50" />;
  const max = Math.max(...points.map((p) => p.y), 1);
  const w = 320;
  const h = 96;
  const step = points.length === 1 ? 0 : w / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = i * step;
      const y = h - (p.y / max) * (h - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${d} L${(points.length - 1) * step} ${h} L0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full" role="img">
      <path d={area} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}
