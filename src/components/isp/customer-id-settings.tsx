import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { SaveButton, SettingsField, SettingsStatus, type SettingsNote } from "@/components/isp/settings-ui";
import { ID_SAVE_FAIL, ID_SAVE_OK, safeSettingsError } from "@/lib/isp/settings-feedback";
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
  const [note, setNote] = useState<SettingsNote>(null);
  const lock = useRef(false);

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
    if (lock.current || form.locked) return;
    lock.current = true;
    setBusy(true);
    setNote(null);
    try {
      const desk = await saveCustomerIdSettingsFn({ data: { start_n: Math.max(1, Math.floor(Number(start) || 1)) } });
      setForm(desk);
      setStart(String(desk.start_n));
      setNote({ ok: true, text: ID_SAVE_OK });
    } catch (err) {
      setNote({ ok: false, text: safeSettingsError(err, ID_SAVE_FAIL) });
    } finally {
      lock.current = false;
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
        <SettingsField label="Starting number" required hint="Existing customers keep their current IDs. New customers receive the next unused number.">
          <Input
            type="number"
            min={1}
            max={99999999}
            value={start}
            disabled={form.locked || busy}
            onChange={(e) => {
              setStart(e.target.value);
              setNote(null);
            }}
          />
        </SettingsField>
        <SettingsField label="Next ID preview">
          <Input value={preview} readOnly />
        </SettingsField>
        <SettingsStatus note={note} />
        {form.locked ? (
          <p className="text-sm text-muted">Normal staff cannot change the sequence after IDs have been issued.</p>
        ) : (
          <SaveButton busy={busy} label="Save changes" />
        )}
      </form>
    </div>
  );
}
