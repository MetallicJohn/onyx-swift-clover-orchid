import { X } from "lucide-react";

export type FilterChip = { id: string; label: string };

export function FilterChips({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: FilterChip[];
  onRemove: (id: string) => void;
  onClearAll?: () => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onRemove(chip.id)}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-elevated px-2.5 text-xs text-fg hover:bg-surface"
        >
          {chip.label}
          <X className="size-3" aria-hidden />
          <span className="sr-only">Remove {chip.label}</span>
        </button>
      ))}
      {onClearAll ? (
        <button type="button" onClick={onClearAll} className="h-8 px-2 text-xs font-medium text-accent hover:underline">
          Clear all
        </button>
      ) : null}
    </div>
  );
}
