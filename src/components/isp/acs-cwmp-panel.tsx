import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CWMP_KEYS = [
  ["cwmp.auth", "CPE digest login"],
  ["cwmp.connectionRequestAuth", "Connection-request auth"],
  ["cwmp.connectionRequestAllowBasicAuth", "Allow basic connection-request"],
  ["cwmp.debug", "CWMP debug"],
] as const;

export type CwmpSnapshot = {
  ok: boolean;
  error: string;
  values: Record<string, string>;
};

export type CwmpApplyResult = {
  ok: boolean;
  error: string;
  steps: string[];
  rewritten?: number;
  cwmp?: CwmpSnapshot;
};

function shorten(value: string) {
  const v = value.trim();
  if (v.length <= 72) return v || "—";
  return `${v.slice(0, 56)}…`;
}

export function AcsCwmpPanel({
  snapshot,
  apply,
  busy,
  onApply,
  hint,
}: {
  snapshot: CwmpSnapshot | null;
  apply: CwmpApplyResult | null;
  busy: boolean;
  onApply: () => void;
  hint: string;
}) {
  const values = apply?.cwmp?.values || snapshot?.values || {};
  const reachable = Boolean(apply?.cwmp?.ok || snapshot?.ok);
  const error = apply?.error || (!reachable ? snapshot?.error || "" : "");

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">GenieACS CWMP</h3>
          <p className="mt-1 text-xs text-muted">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={reachable ? "ok" : "warn"}>{reachable ? "ACS reachable" : "ACS not reachable"}</Badge>
          <Button type="button" variant="secondary" disabled={busy} onClick={onApply}>
            {busy ? "Applying…" : "Apply CWMP settings"}
          </Button>
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-sm">
        {CWMP_KEYS.map(([key, label]) => (
          <div key={key} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="break-all font-mono text-xs">{shorten(values[key] || "")}</dd>
          </div>
        ))}
      </dl>
      {apply?.ok ? (
        <p className="mt-3 text-sm text-ok">
          CWMP settings applied{typeof apply.rewritten === "number" ? ` · ${apply.rewritten} ACS URL(s) rewritten` : ""}.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
