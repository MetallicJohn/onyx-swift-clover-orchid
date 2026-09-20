import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { PageHead, Panel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import {
  getSaasSmsSettings,
  listSaasSmsLog,
  saveSaasSmsGateway,
  testSaasSmsGateway,
} from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/settings/sms")({ component: SmsSettingsPage });

function SmsSettingsPage() {
  const [form, setForm] = useState({
    provider: "africastalking",
    api_url: "",
    username: "",
    sender_id: "",
    country: "254",
    enabled: false,
    otp_enabled: true,
    notify_enabled: true,
    otp_template: "",
    otp_ttl_minutes: 5,
    otp_max_attempts: 5,
    reset_per_hour: 5,
    api_key: "",
    api_secret: "",
    api_key_set: false,
    api_secret_set: false,
    api_key_hint: "",
    api_secret_hint: "",
  });
  const [testTo, setTestTo] = useState("");
  const [log, setLog] = useState<{ phone: string; message_type: string; status: string; error_message_sanitized: string; created_at: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    const [s, l] = await Promise.all([getSaasSmsSettings(), listSaasSmsLog({ data: { page: 1 } })]);
    setForm({
      ...form,
      ...s,
      api_key: "",
      api_secret: "",
    });
    setLog(l.messages);
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load SMS settings"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHead
        eyebrow="Platform"
        title="SaaS SMS gateway"
        hint="Password-reset OTP and platform notifications use this provider. Tenant billing SMS stays on each ISP's own settings."
        actions={
          <Link to="/platform/settings" className="text-sm text-accent hover:underline">
            System settings
          </Link>
        }
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
              const saved = await saveSaasSmsGateway({
                data: {
                  provider: form.provider,
                  api_url: form.api_url,
                  username: form.username,
                  sender_id: form.sender_id,
                  country: form.country,
                  enabled: form.enabled,
                  otp_enabled: form.otp_enabled,
                  notify_enabled: form.notify_enabled,
                  otp_template: form.otp_template,
                  otp_ttl_minutes: form.otp_ttl_minutes,
                  otp_max_attempts: form.otp_max_attempts,
                  reset_per_hour: form.reset_per_hour,
                  api_key: form.api_key,
                  api_secret: form.api_secret,
                },
              });
              setForm({ ...form, ...saved, api_key: "", api_secret: "" });
              setOk("SMS gateway saved");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Provider">
            <Select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="africastalking">Africa's Talking</option>
              <option value="advanta">Advanta</option>
              <option value="talksasa">Talksasa</option>
              <option value="blessedtexts">Blessed Texts</option>
              <option value="webfam">Webfam</option>
              <option value="twilio">Twilio</option>
            </Select>
          </Field>
          <Field label="API URL (optional)">
            <Input value={form.api_url} onChange={(e) => setForm({ ...form, api_url: e.target.value })} placeholder="Leave blank for the provider default" />
          </Field>
          <Field label="Username / partner ID">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Sender ID">
            <Input value={form.sender_id} onChange={(e) => setForm({ ...form, sender_id: e.target.value })} />
          </Field>
          <Field label="Default country code">
            <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          </Field>
          <Field label="API key">
            <Input
              type="password"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              placeholder={form.api_key_set ? form.api_key_hint || "************" : "Not set"}
              autoComplete="off"
            />
          </Field>
          <Field label="API secret">
            <Input
              type="password"
              value={form.api_secret}
              onChange={(e) => setForm({ ...form, api_secret: e.target.value })}
              placeholder={form.api_secret_set ? form.api_secret_hint || "************" : "Not set"}
              autoComplete="off"
            />
          </Field>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Gateway enabled
          </label>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={form.otp_enabled} onChange={(e) => setForm({ ...form, otp_enabled: e.target.checked })} />
            OTP enabled
          </label>
          <label className="flex h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={form.notify_enabled} onChange={(e) => setForm({ ...form, notify_enabled: e.target.checked })} />
            Notifications enabled
          </label>
          <Field label="OTP template">
            <Input value={form.otp_template} onChange={(e) => setForm({ ...form, otp_template: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="OTP lifetime (minutes)">
              <Input type="number" min={1} max={30} value={form.otp_ttl_minutes} onChange={(e) => setForm({ ...form, otp_ttl_minutes: Number(e.target.value) })} />
            </Field>
            <Field label="Max OTP attempts">
              <Input type="number" min={3} max={10} value={form.otp_max_attempts} onChange={(e) => setForm({ ...form, otp_max_attempts: Number(e.target.value) })} />
            </Field>
            <Field label="Resets per hour">
              <Input type="number" min={1} max={20} value={form.reset_per_hour} onChange={(e) => setForm({ ...form, reset_per_hour: Number(e.target.value) })} />
            </Field>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {ok ? <p className="text-sm text-ok">{ok}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save SMS gateway"}
          </Button>
        </form>
      </Panel>
      <Panel className="mt-6">
        <h2 className="text-base font-semibold">Test SMS</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setOk(null);
            try {
              const r = await testSaasSmsGateway({ data: { to: testTo } });
              setOk(r.message);
              if (!r.ok) setError(r.message);
              const l = await listSaasSmsLog({ data: { page: 1 } });
              setLog(l.messages);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Test failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Send to">
            <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="0712 000 000" />
          </Field>
          <Button type="submit" disabled={busy}>
            Send test
          </Button>
        </form>
      </Panel>
      <Panel className="mt-6">
        <h2 className="text-base font-semibold">Delivery log</h2>
        <p className="mt-1 text-sm text-muted">OTP values are never stored. Only destination, type, and status.</p>
        {log.length === 0 ? <p className="mt-3 text-sm text-muted">No SMS yet.</p> : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-subtle">
                <th className="py-2">Phone</th>
                <th>Type</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row, i) => (
                <tr key={`${row.created_at}-${i}`} className="border-b border-border/70">
                  <td className="py-2 font-mono text-xs">{row.phone}</td>
                  <td>{row.message_type}</td>
                  <td>{row.status}{row.error_message_sanitized ? ` — ${row.error_message_sanitized}` : ""}</td>
                  <td className="text-xs">{nairobiTime(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
