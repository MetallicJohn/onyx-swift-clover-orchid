import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHead, Panel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { getSaasSettings, saveSaasSettings } from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/settings")({ component: SettingsPage });

function SettingsPage() {
  const [form, setForm] = useState({
    grace_days: 3,
    past_due_days: 7,
    trial_days: 14,
    support_access_enabled: false,
    support_access_minutes: 30,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    getSaasSettings()
      .then(setForm)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);

  return (
    <div>
      <PageHead
        eyebrow="Platform"
        title="System settings"
        hint={`${APP_NAME} defaults for trials, dunning, and optional support access. Tenant branding is never edited here.`}
      />
      <Panel>
        <form
          className="grid max-w-xl gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setOk(null);
            try {
              const saved = await saveSaasSettings({ data: form });
              setForm(saved);
              setOk("Saved");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Default trial days">
            <Input type="number" min={1} value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })} />
          </Field>
          <Field label="Grace period (days after renewal)">
            <Input type="number" min={0} value={form.grace_days} onChange={(e) => setForm({ ...form, grace_days: Number(e.target.value) })} />
          </Field>
          <Field label="Past-due window before suspend (days)">
            <Input type="number" min={0} value={form.past_due_days} onChange={(e) => setForm({ ...form, past_due_days: Number(e.target.value) })} />
          </Field>
          <Field label="Support session length (minutes)">
            <Input
              type="number"
              min={5}
              value={form.support_access_minutes}
              onChange={(e) => setForm({ ...form, support_access_minutes: Number(e.target.value) })}
            />
          </Field>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.support_access_enabled}
              onChange={(e) => setForm({ ...form, support_access_enabled: e.target.checked })}
            />
            Enable time-limited support access
          </label>
          <p className="text-xs text-muted">
            Off by default. When on, a Superadmin can open a read-mostly, audited session in an ISP console. They never become the owner account.
          </p>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {ok ? <p className="text-sm text-ok">{ok}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
