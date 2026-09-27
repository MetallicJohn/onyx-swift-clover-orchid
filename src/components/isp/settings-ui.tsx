import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SettingsNote = { ok: boolean; text: string } | null;

export function SettingsSubnav<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { id: T; label: string; mark?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex snap-x gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        const tabKey = `${label}-${tab.id}`.replace(/\s+/g, "-").toLowerCase();
        return (
          <button
            key={tab.id}
            id={`settings-tab-${tabKey}`}
            type="button"
            role="tab"
            aria-selected={active}
            data-settings-tab={tab.id}
            className={cn(
              "h-11 shrink-0 snap-start rounded-lg px-4 text-sm font-medium transition-colors",
              active ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={() => {
              document.getElementById(`settings-tab-${tabKey}`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
              onChange(tab.id);
            }}
          >
            {tab.label}
            {tab.mark ? <span className="ml-1">{tab.mark}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsStatus({ note }: { note: SettingsNote }) {
  if (!note) return null;
  return (
    <p role="status" aria-live="polite" className={note.ok ? "text-sm text-ok" : "text-sm text-danger"}>
      {note.ok ? `✓ ${note.text}` : note.text}
    </p>
  );
}

export function SaveButton({
  busy,
  label,
  pending = "Saving…",
}: {
  busy: boolean;
  label: string;
  pending?: string;
}) {
  return (
    <Button type="submit" disabled={busy} aria-busy={busy}>
      {busy ? pending : label}
    </Button>
  );
}

export function SettingsField({
  label,
  required,
  optional,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  const text = required ? `${label} *` : optional ? `${label} (optional)` : label;
  return (
    <div className="grid gap-1">
      <Field label={text}>{children}</Field>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SecretInput({
  value,
  onChange,
  placeholder,
  autoComplete = "off",
  minLength,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <Input
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button type="button" variant="secondary" onClick={() => setShow((v) => !v)} aria-pressed={show}>
        {show ? "Hide" : "Show"}
      </Button>
    </div>
  );
}

export function SettingsCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
