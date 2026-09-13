import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import {
  formatFromSettings,
  isIncrementingToken,
  isRandomAccountNumber,
  randomAccountNumber,
  sequenceKind,
  tokenFromIndex,
  tokenIndex,
  type AccountNumberSettings,
  type AccountScheme,
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
  enabled: true,
  scheme: "random",
  prefix: "CUS",
  suffix: "",
  separator: "",
  start_n: 1000,
  next_n: 1000,
  digits: 4,
  allow_manual: false,
  prefix_permanent: true,
  suffix_permanent: true,
  next_prefix_n: 0,
  next_suffix_n: 0,
  updated_at: null,
  preview: "K7N3P",
  example_start: "K7N3P",
  example_next: "4H9MQ",
  example_third: "P2T8W",
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
    if (form.scheme === "random") {
      const start = isRandomAccountNumber(form.example_start) ? form.example_start : randomAccountNumber();
      const second = isRandomAccountNumber(form.example_next) ? form.example_next : randomAccountNumber();
      const third = isRandomAccountNumber(form.example_third) ? form.example_third : randomAccountNumber();
      return {
        kind: "random" as const,
        next: start,
        start,
        second,
        third,
      };
    }
    const desk = {
      scheme: form.scheme,
      prefix: form.prefix,
      suffix: form.suffix,
      separator: form.separator,
      start_n: form.start_n,
      next_n: form.next_n,
      digits: form.digits,
      prefix_permanent: form.prefix_permanent,
      suffix_permanent: form.suffix_permanent,
      next_prefix_n: form.next_prefix_n,
      next_suffix_n: form.next_suffix_n,
    };
    const kind = sequenceKind(desk);
    return {
      kind,
      next: formatFromSettings(desk, 0, "next"),
      start: formatFromSettings(desk, 0, "start"),
      second: formatFromSettings(desk, 1, "start"),
      third: formatFromSettings(desk, 2, "start"),
    };
  }, [
    form.scheme,
    form.prefix,
    form.suffix,
    form.separator,
    form.start_n,
    form.next_n,
    form.digits,
    form.prefix_permanent,
    form.suffix_permanent,
    form.next_prefix_n,
    form.next_suffix_n,
    form.example_start,
    form.example_next,
    form.example_third,
  ]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const desk = await saveAccountNumberSettingsFn({
        data: {
          enabled: form.enabled,
          scheme: form.scheme,
          prefix: form.prefix,
          suffix: form.suffix,
          separator: form.separator,
          start_n: form.start_n,
          next_n: form.next_n,
          digits: form.digits,
          allow_manual: form.allow_manual,
          prefix_permanent: form.prefix_permanent,
          suffix_permanent: form.suffix_permanent,
          next_prefix_n: form.next_prefix_n,
          next_suffix_n: form.next_suffix_n,
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
          {live.kind === "random"
            ? `Examples ${live.start}, ${live.second}, ${live.third}. Each new customer gets a unique 5-character code — letters and numbers, no separator. I, O, and L are omitted so they are not read as 1 or 0.`
            : live.kind === "suffix"
              ? `Next number assigned on save of a new customer. Sequence ${live.start}, ${live.second}, ${live.third}. Letter suffix advances A → B → C (then AA). The numeric part stays at the starting number.`
              : live.kind === "prefix"
                ? `Next number assigned on save of a new customer. Sequence ${live.start}, ${live.second}, ${live.third}. Letter prefix advances alphabetically. The numeric part stays at the starting number.`
                : `Next number assigned on save of a new customer. Sequence ${live.start}, ${live.second}, ${live.third}. The number increases; prefix and suffix stay as written.`}
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
        <div className="flex flex-wrap gap-2 md:col-span-2">
          {(["random", "sequence"] as AccountScheme[]).map((id) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={form.scheme === id ? "default" : "secondary"}
              onClick={() => setForm({ ...form, scheme: id })}
            >
              {id === "random" ? "Random codes" : "Sequential"}
            </Button>
          ))}
        </div>
        {form.scheme === "random" ? (
          <p className="text-sm text-muted md:col-span-2">
            Default when this ISP has not set a format: five characters, no hyphen or slash. Mix of
            letters and digits. Never uses I, O, or L.
          </p>
        ) : null}
        {form.scheme === "sequence" ? (
          <>
        <Field label="Prefix">
          <Input
            value={form.prefix}
            onChange={(e) => {
              const prefix = e.target.value.toUpperCase();
              setForm({
                ...form,
                prefix,
                next_prefix_n: isIncrementingToken(prefix) ? Math.max(form.next_prefix_n, tokenIndex(prefix)) : form.next_prefix_n,
              });
            }}
            placeholder={form.slug_prefix}
            maxLength={12}
            required={form.enabled}
          />
        </Field>
        <Field label="Suffix (optional)">
          <Input
            value={form.suffix}
            onChange={(e) => {
              const suffix = e.target.value.toUpperCase();
              setForm({
                ...form,
                suffix,
                next_suffix_n: isIncrementingToken(suffix) ? Math.max(form.next_suffix_n, tokenIndex(suffix)) : 0,
              });
            }}
            maxLength={12}
            placeholder="A or KE"
          />
        </Field>
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm">
          <input
            type="checkbox"
            checked={form.prefix_permanent}
            onChange={(e) => {
              const prefix_permanent = e.target.checked;
              setForm({
                ...form,
                prefix_permanent,
                next_prefix_n:
                  !prefix_permanent && isIncrementingToken(form.prefix)
                    ? Math.max(form.next_prefix_n, tokenIndex(form.prefix))
                    : form.next_prefix_n,
              });
            }}
          />
          Keep prefix permanent
        </label>
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm">
          <input
            type="checkbox"
            checked={form.suffix_permanent}
            onChange={(e) => {
              const suffix_permanent = e.target.checked;
              setForm({
                ...form,
                suffix_permanent,
                next_suffix_n:
                  !suffix_permanent && isIncrementingToken(form.suffix)
                    ? Math.max(form.next_suffix_n, tokenIndex(form.suffix))
                    : form.next_suffix_n,
              });
            }}
          />
          Keep suffix permanent
        </label>
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
            disabled={live.kind !== "number"}
          />
        </Field>
        {!form.prefix_permanent && isIncrementingToken(form.prefix) ? (
          <Field label="Next prefix">
            <Input
              value={tokenFromIndex(form.prefix, form.next_prefix_n)}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                if (!v || isIncrementingToken(v)) setForm({ ...form, next_prefix_n: tokenIndex(v || form.prefix) });
              }}
              maxLength={12}
            />
          </Field>
        ) : null}
        {!form.suffix_permanent && isIncrementingToken(form.suffix) ? (
          <Field label="Next suffix">
            <Input
              value={tokenFromIndex(form.suffix, form.next_suffix_n)}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                if (!v || isIncrementingToken(v)) setForm({ ...form, next_suffix_n: tokenIndex(v || form.suffix) });
              }}
              maxLength={12}
            />
          </Field>
        ) : null}
        <p className="text-xs text-subtle md:col-span-2">
          Zero-padding uses the digit count: 1 with 4 digits is 0001. Uncheck “permanent” on a letter
          suffix to advance A, B, C … Z, AA while the number stays at the starting value. Leave both
          locked to increment the number instead (IMN1000, IMN1001). If both can change, the suffix
          is the one that advances.
        </p>
          </>
        ) : null}
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
                setForm({
                  ...EMPTY,
                  ...desk,
                  preview: desk.preview,
                  example_start: desk.example_start,
                  example_next: desk.example_next,
                  example_third: desk.example_third,
                  slug_prefix: desk.slug_prefix || desk.prefix,
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
