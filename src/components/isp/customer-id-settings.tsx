import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { getCustomerIdSettingsFn, saveCustomerIdSettingsFn } from "@/lib/isp/server-customer-ids";

type Desk = {
  start_n: number;
  next_preview: string;
  configured: boolean;
  issued: boolean;
  locked: boolean;
};

const EMPTY: Desk = {
  start_n: 1,
  next_preview: "1",
  configured: false,
  issued: false,
  locked: false,
};

export function CustomerIdSettings() {
  const [form, setForm] = useState<Desk>(EMPTY);
  const [start, setStart] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    const desk = await getCustomerIdSettingsFn();
    setForm(desk);
    setStart(String(desk.start_n));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const preview = form.locked ? form.next_preview : String(Math.max(1, Math.floor(Number(start) || 1)));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const desk = await saveCustomerIdSettingsFn({ data: { start_n: Math.max(1, Math.floor(Number(start) || 1)) } });
      setForm(desk);
      setStart(String(desk.start_n));
      setSaved("Starting number saved. Existing customers keep their current IDs.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">ID Settings</h2>
        <p className="text-sm text-muted">
          Numeric IDs for customers on this ISP. New customers receive the next unused number. Existing IDs are never
          rewritten.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-xs tracking-wide text-accent uppercase">Next ID preview</div>
        <div className="mt-1 font-mono text-2xl tracking-tight">{preview}</div>
        <p className="mt-1 text-sm text-muted">
          {form.locked
            ? "IDs have already been issued. The sequence cannot be changed."
            : "This is the next ID a new customer will receive."}
        </p>
      </div>

      <form
        className="grid max-w-md gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.locked) return;
          void save();
        }}
      >
        <Field label="Starting number">
          <Input
            type="number"
            min={1}
            max={99999999}
            value={start}
            disabled={form.locked || busy}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Next ID preview">
          <Input value={preview} readOnly />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {saved ? <p className="text-sm text-accent">{saved}</p> : null}
        {form.locked ? (
          <p className="text-sm text-muted">Normal staff cannot change the sequence after IDs have been issued.</p>
        ) : (
          <div>
            <Button type="submit" disabled={busy}>
              Save changes
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
