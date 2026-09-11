import { cn } from "@/lib/utils";

export type TagOption = { id: string; name: string; enabled?: boolean; customer_count?: number };

export function TagPicker({
  tags,
  selected,
  onChange,
  disabled,
  empty = "No tags yet. Create them under Settings → Customer tags.",
}: {
  tags: TagOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  empty?: string;
}) {
  const enabled = tags.filter((t) => t.enabled !== false);
  if (!enabled.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {enabled.map((t) => {
        const on = selected.includes(t.id);
        return (
          <label
            key={t.id}
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm",
              on ? "border-accent bg-accent/15 text-fg" : "border-border bg-bg text-muted",
              disabled ? "pointer-events-none opacity-60" : "",
            )}
          >
            <input
              type="checkbox"
              className="size-4"
              checked={on}
              disabled={disabled}
              onChange={() => onChange(on ? selected.filter((id) => id !== t.id) : [...selected, t.id])}
            />
            <span className="normal-case">{t.name}</span>
          </label>
        );
      })}
    </div>
  );
}

export function TagList({ tags }: { tags: { id: string; name: string }[] }) {
  if (!tags.length) return <span className="text-xs text-subtle">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t.id} className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
          {t.name}
        </span>
      ))}
    </div>
  );
}
