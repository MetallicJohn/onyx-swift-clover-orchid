import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { SettingsCheck } from "@/components/isp/settings-ui";
import {
  formatFromSettings,
  isIncrementingToken,
  randomAccountNumber,
  sequenceKind,
  tokenFromIndex,
  tokenIndex,
  type AccountNumberSettings,
  type AccountSeparator,
} from "@/lib/isp/account-numbers";
import {
  ACCOUNT_CHARSETS,
  ACCOUNT_MODES,
  compilePattern,
  DEFAULT_SERVICE_CODES,
  DEFAULT_TYPE_CODES,
  parseCodeMap,
  parsePattern,
  partLabel,
  presetPattern,
  renderPattern,
  RESET_POLICIES,
  SEQUENCE_SCOPES,
  stringifyCodeMap,
  usesPatternMode,
  validateAccountValue,
  type AccountMode,
  type PatternPart,
  type ResetPolicy,
  type SequenceScope,
} from "@/lib/isp/account-pattern";
import {
  getAccountNumberSettingsFn,
  linkLegacyAccountNumberFn,
  removeAccountReservationFn,
  reserveAccountNumberFn,
  resetAccountNumberSettingsFn,
  saveAccountNumberSettingsFn,
  testAccountNumbersFn,
} from "@/lib/isp/server-account-numbers";

type Reservation = { id: string; kind: string; value: string; value_end: string };
type HistoryRow = {
  id: string;
  account_number: string;
  previous_number: string;
  source: string;
  mode: string;
  pattern: string;
  config_version: number;
  reason: string;
  created_at: string;
};
type VersionRow = { version: number; mode: string; pattern: string; created_at: string };
type Desk = AccountNumberSettings & {
  preview: string;
  example_start: string;
  example_next: string;
  example_third: string;
  slug_prefix: string;
  reservations: Reservation[];
  history: HistoryRow[];
  versions: VersionRow[];
};
type TestSample = { value: string; length: number; reserved: boolean; duplicate: boolean; valid: boolean };

const MODE_LABEL: Record<string, string> = {
  random: "Random codes",
  sequential: "Automatic sequential",
  prefix: "Prefix + sequential",
  type: "Customer type + sequential",
  branch: "Branch + sequential",
  period: "Year + sequential",
  pattern: "Custom pattern",
  manual: "Manual assignment",
  import: "Import existing numbers",
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
  mode: "legacy",
  pattern: "",
  assign_on: "service",
  seq_scope: "tenant",
  increment_by: 1,
  reset_policy: "never",
  min_length: 1,
  max_length: 32,
  charset: "alnum",
  type_codes: "",
  service_codes: "",
  branch_codes: "",
  area_codes: "",
  default_branch: "",
  config_version: 1,
  import_preserve: true,
  preview: "",
  example_start: "",
  example_next: "",
  example_third: "",
  slug_prefix: "CUS",
  reservations: [],
  history: [],
  versions: [],
};

function presentedMode(desk: { mode: string; scheme: string }): AccountMode {
  if (desk.mode === "legacy") return desk.scheme === "sequence" ? "prefix" : "random";
  return (ACCOUNT_MODES as readonly string[]).includes(desk.mode) ? (desk.mode as AccountMode) : "random";
}

function originOf(form: Desk, mode: string) {
  if ((mode === "prefix" || mode === "sequential" || mode === "pattern") && form.seq_scope === "tenant") {
    return Math.max(form.start_n, form.next_n);
  }
  return form.start_n;
}

export function AccountNumberSettings() {
  const [form, setForm] = useState<Desk>(EMPTY);
  const [uiMode, setUiMode] = useState<AccountMode>("random");
  const [modeTouched, setModeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [samples, setSamples] = useState<TestSample[] | null>(null);
  const [reserveKind, setReserveKind] = useState<"number" | "range" | "prefix">("number");
  const [reserveValue, setReserveValue] = useState("");
  const [reserveEnd, setReserveEnd] = useState("");
  const [legacyAlias, setLegacyAlias] = useState("");
  const [legacyCurrent, setLegacyCurrent] = useState("");

  function applyDesk(desk: Desk) {
    const next = { ...EMPTY, ...desk, reservations: desk.reservations || [], history: desk.history || [], versions: desk.versions || [] };
    setForm(next);
    setUiMode(presentedMode(next));
    setModeTouched(false);
  }

  useEffect(() => {
    getAccountNumberSettingsFn()
      .then((desk) => applyDesk(desk as Desk))
      .catch(console.error);
  }, []);

  const usingLegacy = !modeTouched && form.mode === "legacy";
  const livePattern = useMemo(() => {
    if (uiMode === "random" || uiMode === "manual" || uiMode === "import") return form.pattern;
    return form.pattern || presetPattern(uiMode, form);
  }, [form, uiMode]);
  const parts = useMemo(() => (livePattern ? parsePattern(livePattern).parts : []), [livePattern]);

  const preview = useMemo(() => {
    if (usingLegacy || uiMode === "random") {
      if (form.scheme === "random" || uiMode === "random") {
        return {
          next: form.example_start || randomAccountNumber(),
          lines: [form.example_start, form.example_next, form.example_third].filter(Boolean),
          error: "",
          length: 5,
        };
      }
      const kind = sequenceKind(form);
      const lines = [0, 1, 2].map((offset) => formatFromSettings(form, offset, kind === "number" ? "next" : "start"));
      return { next: formatFromSettings(form, 0, "next"), lines, error: "", length: lines[0]?.length || 0 };
    }
    if (uiMode === "manual") return { next: "Typed by staff", lines: [], error: "", length: 0 };
    if (uiMode === "import" && !livePattern) return { next: "Kept from import", lines: [], error: "", length: 0 };
    const branches = parseCodeMap(form.branch_codes);
    const areas = parseCodeMap(form.area_codes);
    const ctx = {
      prefix: form.prefix,
      separator: form.separator,
      typeCode: { ...DEFAULT_TYPE_CODES, ...parseCodeMap(form.type_codes) }.individual || "RES",
      branchCode: form.default_branch || Object.values(branches)[0] || "",
      areaCode: Object.values(areas)[0] || "",
      serviceCode: { ...DEFAULT_SERVICE_CODES, ...parseCodeMap(form.service_codes) }.pppoe || "PP",
      customerId: "1001",
    };
    const lines = [0, 1, 2].map((offset) => {
      const rendered = renderPattern(livePattern, { ...ctx, seq: originOf(form, uiMode) + offset * form.increment_by });
      return rendered.errors[0] || rendered.value;
    });
    const error = lines[0]?.includes(" ") ? lines[0] : "";
    const checked = error
      ? { errors: [error] }
      : validateAccountValue(lines[0] || "", {
          minLength: form.min_length,
          maxLength: form.max_length,
          charset: form.charset,
          check: livePattern.includes("{CHECK}"),
        });
    return {
      next: lines[0] || "—",
      lines,
      error: checked.errors[0] || "",
      length: error ? 0 : (lines[0] || "").length,
    };
  }, [form, livePattern, uiMode, usingLegacy]);

  function editPattern(next: string) {
    setModeTouched(true);
    setUiMode("pattern");
    setForm((current) => ({ ...current, pattern: next }));
    setSamples(null);
  }

  function chooseMode(mode: AccountMode) {
    setModeTouched(true);
    setUiMode(mode);
    setSamples(null);
    setForm((current) => {
      if (mode === "random") return { ...current, pattern: "" };
      if (mode === "manual" || mode === "import") return current;
      if (mode === "pattern") return { ...current, pattern: current.pattern || presetPattern("prefix", current) };
      return { ...current, pattern: presetPattern(mode, current) };
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const mode = modeTouched ? uiMode : form.mode;
      const pattern = usesPatternMode(mode) ? livePattern : modeTouched && uiMode === "random" ? "" : form.pattern;
      const scheme = modeTouched && uiMode === "random" ? "random" : usesPatternMode(mode) ? "sequence" : form.scheme;
      const desk = await saveAccountNumberSettingsFn({
        data: {
          enabled: mode === "manual" ? false : form.enabled,
          scheme,
          prefix: form.prefix,
          suffix: form.suffix,
          separator: form.separator,
          start_n: form.start_n,
          next_n: form.next_n,
          digits: form.digits,
          allow_manual: mode === "manual" ? true : form.allow_manual,
          prefix_permanent: form.prefix_permanent,
          suffix_permanent: form.suffix_permanent,
          next_prefix_n: form.next_prefix_n,
          next_suffix_n: form.next_suffix_n,
          mode,
          pattern,
          assign_on: form.assign_on,
          seq_scope: form.seq_scope,
          increment_by: form.increment_by,
          reset_policy: form.reset_policy,
          min_length: form.min_length,
          max_length: form.max_length,
          charset: form.charset,
          type_codes: form.type_codes,
          service_codes: form.service_codes,
          branch_codes: form.branch_codes,
          area_codes: form.area_codes,
          default_branch: form.default_branch,
          import_preserve: form.import_preserve,
        },
      });
      applyDesk(desk as Desk);
      setSaved("Saved for future numbers only. Existing accounts, customer IDs, invoices, and payments were not changed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const showBuilder = uiMode !== "random" && uiMode !== "manual";
  const showLegacySequence = usingLegacy && form.scheme === "sequence";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">Account numbers</h2>
        <p className="text-sm text-muted">
          The billing account number for this ISP. It is not the customer ID, not the service ID, and not an invoice or
          payment reference. Once a number is assigned, nobody can change it — not customer care, and not an administrator.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-xs tracking-wide text-accent uppercase">Live preview</div>
        <div className="mt-1 font-mono text-2xl tracking-tight">{preview.next || "—"}</div>
        <p className="mt-1 text-sm text-muted">
          {preview.lines.filter((line) => line && !line.includes(" ")).length
            ? `Examples ${preview.lines.filter((line) => line && !line.includes(" ")).join(", ")}.`
            : "Pick a pattern to see the next numbers."}{" "}
          {preview.length ? `Length ${preview.length}.` : ""}
          {usingLegacy ? " This preview is the format already in use." : " This preview is not saved until you save the format."}
        </p>
        {preview.error ? <p className="mt-1 text-sm text-warn">{preview.error}</p> : null}
        {form.reset_policy !== "never" && livePattern && !/\{YEAR\}|\{YY\}|\{MONTH\}/.test(livePattern) ? (
          <p className="mt-1 text-sm text-muted">
            A reset starts a new counter. If that number is already assigned, the next free number is used instead, so a
            reset cannot create a duplicate.
          </p>
        ) : null}
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!window.confirm("Save this format for future account numbers? Existing numbers stay as they are.")) return;
          void save();
        }}
      >
        <section className="grid max-w-3xl gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
          <h3 className="font-medium md:col-span-2">Generation</h3>
          <Field label="Generation mode">
            <Select value={uiMode} onChange={(event) => chooseMode(event.target.value as AccountMode)}>
              {Object.entries(MODE_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Issued as">
            <Select
              value={form.assign_on}
              onChange={(event) => setForm({ ...form, assign_on: event.target.value === "customer" ? "customer" : "service" })}
            >
              <option value="service">Service account, when the service is created</option>
              <option value="customer">Customer account, still issued with the first service</option>
            </Select>
          </Field>
          <SettingsCheck label="Generate numbers automatically" checked={form.enabled && uiMode !== "manual"} onChange={(enabled) => setForm({ ...form, enabled })} />
          <SettingsCheck
            label="Allow a number to be typed on first assignment"
            checked={uiMode === "manual" || form.allow_manual}
            onChange={(allow_manual) => setForm({ ...form, allow_manual })}
          />
          <p className="text-sm text-muted md:col-span-2">
            Customer IDs stay on their own numeric sequence. A typed number is accepted only when the account has none.
            After assignment the number is permanent. Saving a new format does not rewrite existing numbers, invoices, or
            payments.
          </p>
        </section>

        {showBuilder ? (
          <section className="grid max-w-3xl gap-3 rounded-xl border border-border bg-surface p-4">
            <h3 className="font-medium">Pattern</h3>
            <div className="flex flex-wrap gap-2">
              {parts.length ? (
                parts.map((part, index) => (
                  <span key={`${part.kind}-${index}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-sm">
                    {partLabel(part)}
                    <button type="button" className="text-muted" aria-label="Move earlier" onClick={() => movePart(index, -1)}>
                      ↑
                    </button>
                    <button type="button" className="text-muted" aria-label="Move later" onClick={() => movePart(index, 1)}>
                      ↓
                    </button>
                    <button type="button" className="text-danger" aria-label="Remove component" onClick={() => editPattern(compilePattern(parts.filter((_, i) => i !== index)))}>
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted">Add components. The order here is the order in the account number.</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["Prefix", { kind: "prefix" }],
                  ["Sequence", { kind: "seq", digits: form.digits }],
                  ["Customer ID", { kind: "customer" }],
                  ["Customer type", { kind: "type" }],
                  ["Branch", { kind: "branch" }],
                  ["Area", { kind: "area" }],
                  ["Service type", { kind: "service" }],
                  ["Year", { kind: "year" }],
                  ["Year (2)", { kind: "yy" }],
                  ["Month", { kind: "month" }],
                  ["Day", { kind: "day" }],
                  ["Random digits", { kind: "rand", length: 4, alpha: false }],
                  ["Random letters", { kind: "rand", length: 4, alpha: true }],
                  ["Check digit", { kind: "check" }],
                  ["Separator", { kind: "sep" }],
                ] as [string, PatternPart][]
              ).map(([label, part]) => (
                <Button key={label} type="button" size="sm" variant="secondary" onClick={() => editPattern(compilePattern([...parts, part]))}>
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Fixed text">
                <Input value={textDraft} maxLength={12} placeholder="ACC" onChange={(event) => setTextDraft(event.target.value.toUpperCase())} />
              </Field>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const value = textDraft.toUpperCase().replace(/[^A-Z0-9]/g, "");
                  if (!value) return;
                  editPattern(compilePattern([...parts, { kind: "text", value }]));
                  setTextDraft("");
                }}
              >
                Add text
              </Button>
            </div>
            <p className="font-mono text-sm text-muted">{livePattern || "No pattern yet"}</p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Prefix">
                <Input
                  value={form.prefix}
                  maxLength={12}
                  onChange={(event) => {
                    const prefix = event.target.value.toUpperCase();
                    setForm((current) => ({ ...current, prefix, pattern: uiMode === "pattern" ? current.pattern : presetPattern(uiMode, { ...current, prefix }) }));
                  }}
                />
              </Field>
              <Field label="Separator">
                <Select
                  value={form.separator}
                  onChange={(event) => {
                    const separator = event.target.value as AccountSeparator;
                    setForm((current) => ({
                      ...current,
                      separator,
                      pattern: uiMode === "pattern" ? current.pattern : presetPattern(uiMode, { ...current, separator }),
                    }));
                  }}
                >
                  <option value="">None</option>
                  <option value="-">Hyphen</option>
                  <option value="/">Slash</option>
                </Select>
              </Field>
              <Field label="Sequence padding">
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={form.digits}
                  onChange={(event) => {
                    const digits = Math.min(8, Math.max(1, Number(event.target.value) || 1));
                    setForm((current) => ({
                      ...current,
                      digits,
                      pattern:
                        uiMode === "pattern"
                          ? (current.pattern || livePattern).replace(/\{SEQ:\d+\}/g, `{SEQ:${digits}}`)
                          : presetPattern(uiMode, { ...current, digits }),
                    }));
                  }}
                />
              </Field>
            </div>
          </section>
        ) : null}

        {showLegacySequence ? (
          <section className="grid max-w-3xl gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
            <h3 className="font-medium md:col-span-2">Current letter sequence</h3>
            <p className="text-sm text-muted md:col-span-2">
              This ISP still uses the existing sequential format. These controls keep that format. Choose a generation mode
              above and save when you want new numbers to use the pattern builder instead.
            </p>
            <Field label="Suffix">
              <Input value={form.suffix} maxLength={12} onChange={(event) => setForm({ ...form, suffix: event.target.value.toUpperCase() })} />
            </Field>
            <SettingsCheck label="Keep prefix permanent" checked={form.prefix_permanent} onChange={(prefix_permanent) => setForm({ ...form, prefix_permanent })} />
            <SettingsCheck label="Keep suffix permanent" checked={form.suffix_permanent} onChange={(suffix_permanent) => setForm({ ...form, suffix_permanent })} />
            {!form.prefix_permanent && isIncrementingToken(form.prefix) ? (
              <Field label="Next prefix">
                <Input
                  value={tokenFromIndex(form.prefix, form.next_prefix_n)}
                  onChange={(event) => setForm({ ...form, next_prefix_n: tokenIndex(event.target.value.toUpperCase() || form.prefix) })}
                />
              </Field>
            ) : null}
            {!form.suffix_permanent && isIncrementingToken(form.suffix) ? (
              <Field label="Next suffix">
                <Input
                  value={tokenFromIndex(form.suffix, form.next_suffix_n)}
                  onChange={(event) => setForm({ ...form, next_suffix_n: tokenIndex(event.target.value.toUpperCase() || form.suffix) })}
                />
              </Field>
            ) : null}
          </section>
        ) : null}

        <section className="grid max-w-3xl gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
          <h3 className="font-medium md:col-span-2">Sequence</h3>
          <Field label="Starting number">
            <Input
              type="number"
              min={0}
              value={form.start_n}
              onChange={(event) => {
                const start_n = Number(event.target.value);
                setForm({ ...form, start_n, next_n: form.next_n < start_n ? start_n : form.next_n });
              }}
            />
          </Field>
          <Field label="Next number">
            <Input type="number" min={0} value={form.next_n} onChange={(event) => setForm({ ...form, next_n: Number(event.target.value) })} />
          </Field>
          <Field label="Increment">
            <Input
              type="number"
              min={1}
              max={100}
              value={form.increment_by}
              onChange={(event) => setForm({ ...form, increment_by: Math.min(100, Math.max(1, Number(event.target.value) || 1)) })}
            />
          </Field>
          <Field label="Sequence scope">
            <Select value={form.seq_scope} onChange={(event) => setForm({ ...form, seq_scope: event.target.value as SequenceScope })}>
              {SEQUENCE_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope.replace("_", " + ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reset">
            <Select value={form.reset_policy} onChange={(event) => setForm({ ...form, reset_policy: event.target.value as ResetPolicy })}>
              {RESET_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {policy === "never" ? "Never" : policy.replace("_", " per ")}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-muted md:col-span-2">
            Current sequence {form.next_n}. Next generated value starts at {originOf(form, uiMode)} and steps by {form.increment_by}. Counters for
            different branches, types, or years do not share a number when the scope says so.
          </p>
        </section>

        <section className="grid max-w-3xl gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
          <h3 className="font-medium md:col-span-2">Rules</h3>
          <Field label="Minimum length">
            <Input type="number" min={1} max={32} value={form.min_length} onChange={(event) => setForm({ ...form, min_length: Number(event.target.value) })} />
          </Field>
          <Field label="Maximum length">
            <Input type="number" min={1} max={32} value={form.max_length} onChange={(event) => setForm({ ...form, max_length: Number(event.target.value) })} />
          </Field>
          <Field label="Allowed characters">
            <Select value={form.charset} onChange={(event) => setForm({ ...form, charset: event.target.value as Desk["charset"] })}>
              {ACCOUNT_CHARSETS.map((charset) => (
                <option key={charset} value={charset}>
                  {charset === "numeric" ? "Numbers only" : charset === "upper" ? "Uppercase letters and numbers" : "Letters and numbers"}
                </option>
              ))}
            </Select>
          </Field>
          <SettingsCheck label="Keep imported numbers" checked={form.import_preserve} onChange={(import_preserve) => setForm({ ...form, import_preserve })} />
          <p className="text-sm text-muted md:col-span-2">
            Spaces and symbols other than a hyphen or slash are rejected. Matching ignores letter case, so imn-0001 and
            IMN-0001 are the same number. Reserved values below are never issued automatically.
          </p>
        </section>

        <div className="flex max-w-3xl flex-wrap gap-2">
          {error ? <p className="w-full text-sm text-danger">{error}</p> : null}
          {saved ? <p className="w-full text-sm text-accent">{saved}</p> : null}
          <Button type="submit" disabled={busy}>
            Save changes
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("Restore the default format? Existing numbers stay as they are.")) return;
              setBusy(true);
              setError(null);
              try {
                applyDesk((await resetAccountNumberSettingsFn()) as Desk);
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

      <section className="grid max-w-3xl gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
        <h3 className="font-medium md:col-span-2">Overrides</h3>
        <p className="text-sm text-muted md:col-span-2">
          Codes come only from the maps below or the default branch. A street address is never turned into a code.
          Individual is RES, business BUS, corporate CORP, reseller RSL, institution INS. PPPoE is PP, static ST, hotspot
          HS, and DHCP DH unless you change them.
        </p>
        <CodeRows
          label="Customer type codes"
          value={form.type_codes}
          defaults={DEFAULT_TYPE_CODES}
          revision={`${form.updated_at}-${form.config_version}`}
          onChange={(type_codes) => setForm({ ...form, type_codes })}
        />
        <CodeRows
          label="Service type codes"
          value={form.service_codes}
          defaults={DEFAULT_SERVICE_CODES}
          revision={`${form.updated_at}-${form.config_version}`}
          onChange={(service_codes) => setForm({ ...form, service_codes })}
        />
        <CodeRows
          label="Branch codes"
          value={form.branch_codes}
          revision={`${form.updated_at}-${form.config_version}`}
          onChange={(branch_codes) => setForm({ ...form, branch_codes })}
        />
        <CodeRows
          label="Area codes"
          value={form.area_codes}
          revision={`${form.updated_at}-${form.config_version}`}
          onChange={(area_codes) => setForm({ ...form, area_codes })}
        />
        <Field label="Default branch code">
          <Input value={form.default_branch} maxLength={8} placeholder="NYK" onChange={(event) => setForm({ ...form, default_branch: event.target.value.toUpperCase() })} />
        </Field>
      </section>

      <section className="max-w-3xl space-y-3 rounded-xl border border-border bg-surface p-4">
        <h3 className="font-medium">Preview test</h3>
        <p className="text-sm text-muted">Generates examples without moving the production sequence.</p>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const result = await testAccountNumbersFn({ data: { count: 3 } });
              setSamples(result.samples);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not test");
            } finally {
              setBusy(false);
            }
          }}
        >
          Generate test numbers
        </Button>
        {samples ? (
          <ul className="space-y-1 text-sm">
            {samples.map((sample, index) => (
              <li key={`${sample.value}-${index}`} className="font-mono">
                {sample.value} · {sample.length || "—"} characters
                {sample.valid ? " · valid" : ""}
                {sample.reserved ? " · reserved" : ""}
                {sample.duplicate ? " · already used" : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="max-w-3xl space-y-3 rounded-xl border border-border bg-surface p-4">
        <h3 className="font-medium">Reserved numbers</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Kind">
            <Select value={reserveKind} onChange={(event) => setReserveKind(event.target.value as "number" | "range" | "prefix")}>
              <option value="number">Number</option>
              <option value="range">Range</option>
              <option value="prefix">Prefix</option>
            </Select>
          </Field>
          <Field label={reserveKind === "prefix" ? "Prefix" : "From"}>
            <Input value={reserveValue} placeholder={reserveKind === "prefix" ? "TEST-*" : "000001"} onChange={(event) => setReserveValue(event.target.value.toUpperCase())} />
          </Field>
          {reserveKind === "range" ? (
            <Field label="To">
              <Input value={reserveEnd} placeholder="000010" onChange={(event) => setReserveEnd(event.target.value)} />
            </Field>
          ) : null}
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  applyDesk((await reserveAccountNumberFn({ data: { kind: reserveKind, value: reserveValue, value_end: reserveEnd } })) as Desk);
                  setReserveValue("");
                  setReserveEnd("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not reserve");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reserve
            </Button>
          </div>
        </div>
        <ul className="space-y-1 text-sm">
          {form.reservations.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2">
              <span className="font-mono">
                {row.kind} {row.value}
                {row.value_end ? `–${row.value_end}` : ""}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={async () => {
                  setBusy(true);
                  try {
                    applyDesk((await removeAccountReservationFn({ data: { id: row.id } })) as Desk);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not remove");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove
              </Button>
            </li>
          ))}
          {form.reservations.length === 0 ? <li className="text-muted">Nothing reserved.</li> : null}
        </ul>
      </section>

      <section className="max-w-3xl space-y-3 rounded-xl border border-border bg-surface p-4">
        <h3 className="font-medium">Existing accounts</h3>
        <p className="text-sm text-muted">
          Assigned numbers stay on the account that has them. Link a legacy billing number so search can find the customer
          by the old value. Import keeps a supplied number when “Keep imported numbers” is on.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Legacy number">
            <Input value={legacyAlias} onChange={(event) => setLegacyAlias(event.target.value.toUpperCase())} />
          </Field>
          <Field label="Current number">
            <Input value={legacyCurrent} onChange={(event) => setLegacyCurrent(event.target.value.toUpperCase())} />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  applyDesk(
                    (await linkLegacyAccountNumberFn({
                      data: { alias: legacyAlias, account_number: legacyCurrent, reason: "Legacy number linked" },
                    })) as Desk,
                  );
                  setLegacyAlias("");
                  setLegacyCurrent("");
                  setSaved("Legacy number linked. Existing account numbers were not changed.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not link");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Link legacy number
            </Button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="text-sm font-medium">Configuration versions</h4>
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {form.versions.length ? (
                form.versions.map((row) => (
                  <li key={row.version}>
                    Version {row.version}: {row.mode} {row.pattern || "—"}
                  </li>
                ))
              ) : (
                <li>No saved versions yet.</li>
              )}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-medium">Recent assignments</h4>
            <ul className="mt-1 space-y-1 text-sm text-muted">
              {form.history.length ? (
                form.history.map((row) => (
                  <li key={row.id}>
                    {row.account_number}
                    {row.previous_number ? ` (was ${row.previous_number})` : ""} · {row.source}
                  </li>
                ))
              ) : (
                <li>No account-number history yet.</li>
              )}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );

  function movePart(index: number, delta: number) {
    const next = [...parts];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    editPattern(compilePattern(next));
  }
}

function CodeRows({
  label,
  value,
  defaults,
  revision,
  onChange,
}: {
  label: string;
  value: string;
  defaults?: Record<string, string>;
  revision: string;
  onChange: (value: string) => void;
}) {
  const [rows, setRows] = useState(() => codeRows(value, defaults));
  useEffect(() => {
    setRows(codeRows(value, defaults));
  }, [revision]); // eslint-disable-line react-hooks/exhaustive-deps -- reload from the saved desk, not each keystroke
  function commit(next: { id: string; name: string; code: string; locked: boolean }[]) {
    setRows(next);
    const map: Record<string, string> = {};
    for (const row of next) {
      const name = row.name.trim().toLowerCase();
      const code = row.code.trim();
      if (name && code) map[name] = code;
    }
    onChange(stringifyCodeMap(map));
  }
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium tracking-wide text-muted">{label}</span>
      {rows.map((row, index) => (
        <div key={row.id} className="grid grid-cols-[1fr_5rem] gap-2">
          {row.locked ? (
            <span className="flex h-11 items-center rounded-md border border-border bg-bg px-3 text-sm">{row.name}</span>
          ) : (
            <Input
              aria-label={`${label} name`}
              value={row.name}
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, name: event.target.value.toLowerCase() };
                commit(next);
              }}
            />
          )}
          <Input
            aria-label={`${label} code`}
            value={row.code}
            maxLength={8}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, code: event.target.value.toUpperCase() };
              commit(next);
            }}
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => commit([...rows, { id: `new-${rows.length}-${label}`, name: "", code: "", locked: false }])}
      >
        Add code
      </Button>
    </div>
  );
}

function codeRows(value: string, defaults?: Record<string, string>) {
  const stored = parseCodeMap(value);
  const keys = [...new Set([...(defaults ? Object.keys(defaults) : []), ...Object.keys(stored)])];
  return keys.map((key) => ({
    id: key,
    name: key,
    code: stored[key] || defaults?.[key] || "",
    locked: Boolean(defaults && key in defaults),
  }));
}
