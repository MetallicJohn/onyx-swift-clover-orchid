import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { saveCustomerIdSettingsFn } from "@/lib/isp/server-customer-ids";

export function CustomerIdSetupForm({
  onResolved,
  onCancel,
}: {
  onResolved: (start: number) => void;
  onCancel?: () => void;
}) {
  const [start, setStart] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Math.max(1, Math.floor(Number(start) || 1));

  async function confirm(value: number) {
    setBusy(true);
    setError(null);
    try {
      await saveCustomerIdSettingsFn({ data: { start_n: value } });
      onResolved(value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save";
      if (/already been issued/i.test(msg)) {
        onResolved(value);
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="font-medium">ID Settings</h3>
        <p className="mt-1 text-sm text-muted">Choose the starting number for customer IDs. Skip to start from 1.</p>
      </div>
      <Field label="Starting number">
        <Input
          type="number"
          min={1}
          max={99999999}
          value={start}
          autoFocus
          onChange={(e) => setStart(e.target.value)}
        />
      </Field>
      <Field label="Next ID preview">
        <Input value={String(n)} readOnly />
      </Field>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void confirm(n)}>
          Use {n}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void confirm(1)}>
          Skip
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CustomerIdSetupDialog({
  open,
  onResolved,
}: {
  open: boolean;
  onResolved: (start: number) => void;
}) {
  const [busySkip, setBusySkip] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busySkip) {
          setBusySkip(true);
          onResolved(1);
        }
      }}
      title="ID Settings"
      description="Choose the starting number for customer IDs. Skip to start from 1."
    >
      <CustomerIdSetupForm onResolved={onResolved} />
    </Dialog>
  );
}
