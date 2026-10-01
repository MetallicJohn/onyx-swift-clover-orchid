import { Button } from "@/components/ui/button";

export function StickySaveBar({
  dirty,
  saving,
  saved,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  saving?: boolean;
  saved?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  if (!dirty && !saved) return null;
  return (
    <div className="sticky bottom-20 z-30 mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-card md:bottom-4 md:flex-row md:items-center md:justify-between">
      <p className="text-sm" role="status">
        {saving ? "Saving..." : saved && !dirty ? "Saved" : "Unsaved changes"}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onDiscard} disabled={saving || !dirty}>
          Discard
        </Button>
        <Button type="button" onClick={onSave} disabled={saving || !dirty} aria-busy={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
