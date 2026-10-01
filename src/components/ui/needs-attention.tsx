import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type AttentionItem = {
  id: string;
  count: number;
  label: string;
  to: "/app/billing" | "/app/services" | "/app/routers" | "/app/leads" | "/app/tickets" | "/app/customers";
  search?: Record<string, unknown>;
  tone: "normal" | "attention" | "warning" | "critical";
};

const toneClass = {
  normal: "text-fg",
  attention: "text-fg",
  warning: "text-warn",
  critical: "text-danger",
};

export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const visible = items.filter((item) => item.count > 0);
  if (!visible.length) return null;
  return (
    <section aria-label="Needs attention" className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">Needs attention</h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((item) => (
          <li key={item.id}>
            <Link
              to={item.to}
              search={item.search as never}
              className="flex items-center justify-between gap-3 rounded-lg bg-elevated px-3 py-3 hover:bg-bg"
            >
              <span>
                <span className={cn("block font-mono text-xl tabular-nums", toneClass[item.tone])}>{item.count}</span>
                <span className="text-sm text-muted">{item.label}</span>
              </span>
              <span className="text-xs text-accent">View</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
