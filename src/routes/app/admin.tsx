import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { createIspAsAdmin, listPlatformTenants, platformStatus, adminResetPassword } from "@/lib/isp/server-more";

export const Route = createFileRoute("/app/admin")({ component: AdminPage });

function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tenants, setTenants] = useState<
    { id: string; name: string; slug: string; status: string; created_at: string; members: number }[]
  >([]);
  const [form, setForm] = useState({
    isp_name: "",
    owner_name: "",
    owner_email: "",
    owner_password: "",
  });
  const [resetForm, setResetForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function load() {
    const p = await platformStatus();
    setAllowed(p.admin);
    if (!p.admin) return;
    const rows = await listPlatformTenants();
    setTenants(rows.tenants);
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (allowed === false) {
    return <p className="text-sm text-danger">Only an {APP_NAME} superadmin can open this desk.</p>;
  }
  if (allowed === null) return <div className="h-32 animate-pulse rounded-xl bg-surface" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Superadmin</h1>
        <p className="text-sm text-muted">
          Create ISP workspaces and owner logins. Owners sign in with the email and password you set here.
        </p>
      </div>

      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setOk(null);
          try {
            const created = await createIspAsAdmin({ data: form });
            setOk(`Created ${created.tenant_name}. ${created.owner_email} can sign in now.`);
            setForm({ isp_name: "", owner_name: "", owner_email: "", owner_password: "" });
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not create ISP");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="ISP name">
          <Input
            required
            value={form.isp_name}
            onChange={(e) => setForm({ ...form, isp_name: e.target.value })}
            placeholder="Imani Networks Limited"
          />
        </Field>
        <Field label="Owner name">
          <Input
            required
            value={form.owner_name}
            onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
            placeholder="Jane Wanjiku"
          />
        </Field>
        <Field label="Owner email">
          <Input
            type="email"
            required
            value={form.owner_email}
            onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
            placeholder="jane@imani.ke"
          />
        </Field>
        <Field label="Owner password">
          <Input
            type="password"
            required
            minLength={8}
            value={form.owner_password}
            onChange={(e) => setForm({ ...form, owner_password: e.target.value })}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </Field>
        {error ? <p className="text-sm text-danger sm:col-span-2">{error}</p> : null}
        {ok ? <p className="text-sm text-ok sm:col-span-2">{ok}</p> : null}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create ISP + owner login"}
          </Button>
        </div>
      </form>

      <form
        className="grid gap-3 rounded-xl bg-surface p-5 shadow-card sm:grid-cols-2 md:p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setOk(null);
          try {
            const r = await adminResetPassword({ data: resetForm });
            setOk(`Password updated for ${r.email}. They can sign in immediately.`);
            setResetForm({ email: "", password: "" });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not reset password");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="sm:col-span-2">
          <h2 className="font-medium">Reset an operator password</h2>
          <p className="mt-1 text-sm text-muted">
            Sets a new password for an ISP owner, staff login, or another superadmin. Existing sessions are signed out.
          </p>
        </div>
        <Field label="Email">
          <Input
            type="email"
            required
            value={resetForm.email}
            onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })}
            placeholder="jane@imani.ke"
          />
        </Field>
        <Field label="New password">
          <Input
            type="password"
            required
            minLength={8}
            value={resetForm.password}
            onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Set password"}
          </Button>
        </div>
      </form>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {tenants.map((t) => (
          <li key={t.id} className="flex items-center justify-between bg-surface px-4 py-3">
            <div>
              <div className="font-medium">{t.name}</div>
              <div className="text-xs text-muted">
                {t.slug} · {t.members} staff
              </div>
            </div>
            <span className="text-sm text-muted">{t.status}</span>
          </li>
        ))}
        {tenants.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No ISPs yet.</li> : null}
      </ul>
    </div>
  );
}
