import { useState } from "react";
import { Button } from "@/components/ui/button";

export type ColumnChoice = { id: string; label: string; locked?: boolean };

export function ColumnVisibility({
  columns,
  hidden,
  onChange,
}: {
  columns: ColumnChoice[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const hiddenSet = new Set(hidden);
  return (
    <div className="relative">
      <Button type="button" size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Columns
      </Button>
      {open ? (
        <div className="absolute z-40 mt-1 min-w-48 rounded-md border border-border bg-surface p-2 shadow-card">
          <p className="px-2 py-1 text-xs font-medium text-muted">Columns</p>
          <ul>
            {columns.map((column) => {
              const checked = column.locked || !hiddenSet.has(column.id);
              return (
                <li key={column.id}>
                  <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-elevated">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={column.locked}
                      onChange={() => {
                        if (column.locked) return;
                        onChange(checked ? [...hidden, column.id] : hidden.filter((id) => id !== column.id));
                      }}
                    />
                    {column.label}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
