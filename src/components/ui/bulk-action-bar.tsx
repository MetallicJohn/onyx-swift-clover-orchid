import type { ReactNode } from "react";

export function BulkActionBar({
  count,
  noun,
  onClear,
  children,
}: {
  count: number;
  noun: string;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <div className="sticky bottom-20 z-30 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-card md:bottom-4 md:flex-row md:items-center md:justify-between">
      <p className="text-sm font-medium">
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </p>
      <div className="flex flex-wrap gap-2">
        {children}
        <button type="button" className="h-9 px-3 text-sm text-muted hover:text-fg" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
