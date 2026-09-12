import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import {
  formatAccountNumber,
  type AccountNumberSettings,
  type AccountSeparator,
} from "@/lib/isp/account-numbers";
import {
  getAccountNumberSettingsFn,
  resetAccountNumberSettingsFn,
  saveAccountNumberSettingsFn,
} from "@/lib/isp/server-account-numbers";

type Desk = AccountNumberSettings & {
  preview: string;
  example_start: string;
  example_next: string;
  example_third: string;
  slug_prefix: string;
};

const EMPTY: Desk = {
  tenant_id: "",
  enabled: false,
  prefix: "CUS",
  suffix: "",
  separator: "",
  start_n: 1000,
  next_n: 1000,
  digits: 4,
  allow_manual: false,
  updated_at: null,
  preview: "CUS1000",
  example_start: "CUS1000",
  example_next: "CUS1001",
  example_third: "CUS1002",
  slug_prefix: "CUS",
};

export function AccountNumberSettings() {
  const [form, setForm] = useState<Desk>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    const desk = await getAccountNumberSettingsFn();
    setForm({ ...EMPTY, ...desk });
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const live = useMemo(() => {
    const start = formatAccountNumber({
      prefix: form.prefix,
      suffix: form.suffix,
      separator: form.separator,
      n: form.start_n,
      digits: form.digits,
    });
    const next = formatAccountNumber({
      prefix: form.prefix,
      suffix: form.suffix,
      separator: form.separator,
      n: form.next_n,
      digits: form.digits,
    });
    return {
      start,
      next,
      second: formatAccountNumber({
        prefix: form.prefix,
        suffix: form.suffix,
        separator: form.separator,
        n: form.start_n + 1,
        digits: form.digits,
      }),
      third: formatAccountNumber({
        prefix: form.prefix,
        suffix: form.suffix,
        separator: form.separator,
        n: form.start_n + 2,
        digits: form.digits,
      }),
    };
  }, [form.prefix, form.suffix, form.separator, form.start_n, form.next_n, form.digits]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const desk = await saveAccountNumberSettingsFn({
        data: {
          enabled: form.enabled,
          prefix: form.prefix,
          suffix: form.suffix,
          separator: form.separator,
          start_n: form.start_n,
          next_n: form.next_n,
          digits: form.digits,
          allow_manual: form.allow_manual,
        },
      });
      setForm({ ...EMPTY, ...desk });
      setSaved("Account number format saved. Existing customers keep their current numbers.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">Customer account numbers</h2>
        <p className="text-sm text-muted">
          How this ISP numbers new customers. Changing the format does not rename accounts that already exist.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-xs tracking-wide text-accent uppercase">Live preview</div>
        <div className="mt-1 font-mono text-2xl tracking-tight">{live.next}</div>
        <p className="mt-1 text-sm text-muted">
          Next number assigned on save of a new customer. Sequence {live.start}, {live.second}, {live.third}.
        </p>
      </div>

      <form
        className="grid max-w-2xl gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !window.confirm(
              "Save this format for future customers? Existing account numbers stay as they are.",
            )
          ) {
            return;
          }
          void save();
        }}
      >
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Generate account numbers automatically
        </label>
        <Field label="Prefix">
          <Input
            value={form.prefix}
            onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })}
            placeholder={form.slug_prefix}
            maxLength={12}
            required={form.enabled}
          />
        </Field>
        <Field label="Suffix (optional)">
          <Input
            value={form.suffix}
            onChange={(e) => setForm({ ...form, suffix: e.target.value.toUpperCase() })}
            maxLength={12}
            placeholder="None"
          />
        </Field>
        <Field label="Separator">
          <Select
            value={form.separator}
            onChange={(e) => setForm({ ...form, separator: e.target.value as AccountSeparator })}
          >
            <option value="">None (IMN1000)</option>
            <option value="-">Hyphen (CUS-0001)</option>
            <option value="/">Slash (CUS/0001)</option>
          </Select>
        </Field>
        <Field label="Number of digits">
          <Input
            type="number"
            min={1}
            max={8}
            value={form.digits}
            onChange={(e) => setForm({ ...form, digits: Number(e.target.value) })}
          />
        </Field>
        <Field label="Starting number">
          <Input
            type="number"
            min={0}
            max={99999999}
            value={form.start_n}
            onChange={(e) => {
              const start_n = Number(e.target.value);
              setForm({
                ...form,
                start_n,
                next_n: form.next_n < start_n ? start_n : form.next_n,
              });
            }}
          />
        </Field>
        <Field label="Next account number">
          <Input
            type="number"
            min={0}
            max={99999999}
            value={form.next_n}
            onChange={(e) => setForm({ ...form, next_n: Number(e.target.value) })}
          />
        </Field>
        <p className="text-xs text-subtle md:col-span-2">
          Zero-padding uses the digit count: 1 with 4 digits is 0001. Prefix and suffix are letters or numbers only.
        </p>
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={form.allow_manual}
            onChange={(e) => setForm({ ...form, allow_manual: e.target.checked })}
          />
          Allow staff to type or edit an account number
        </label>
        <p className="text-sm text-warn md:col-span-2">
          Saving this format only applies to customers added after this. It will not rewrite current accounts, invoices,
          RADIUS usernames, or tickets.
        </p>
        {error ? <p className="text-sm text-danger md:col-span-2">{error}</p> : null}
        {saved ? <p className="text-sm text-accent md:col-span-2">{saved}</p> : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" disabled={busy}>
            Save changes
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("Restore the default format for this ISP? Existing numbers stay as they are.")) return;
              setBusy(true);
              setError(null);
              try {
                const desk = await resetAccountNumberSettingsFn();
                const preview = formatAccountNumber({ ...desk, n: desk.next_n });
                setForm({
                  ...EMPTY,
                  ...desk,
                  preview,
                  example_start: formatAccountNumber({ ...desk, n: desk.start_n }),
                  example_next: formatAccountNumber({ ...desk, n: desk.start_n + 1 }),
                  example_third: formatAccountNumber({ ...desk, n: desk.start_n + 2 }),
                  slug_prefix: desk.prefix,
                });
                setSaved("Default format restored.");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not reset");
              } finally {
                setBusy(false);
              }
            }}
          >
            Restore default
          </Button>
        </div>
      </form>
    </div>
  );
}
