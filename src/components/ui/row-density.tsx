import type { ViewDensity } from "@/lib/isp/saved-views";
import { cn } from "@/lib/utils";

const OPTIONS: { id: ViewDensity; label: string }[] = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
  { id: "dense", label: "Dense" },
];

export function RowDensity({ value, onChange }: { value: ViewDensity; onChange: (value: ViewDensity) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Row density">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          className={cn(
            "h-8 rounded px-2 text-xs",
            value === option.id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
          )}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
