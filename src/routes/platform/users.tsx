import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { PageHead, Panel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createSaasUser, listSaasUsers } from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/users")({ component: UsersPage });

function UsersPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/platform/users") return <Outlet />;
  return <UsersList />;
}

function UsersList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listSaasUsers>>["users"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", phone: "", platform_admin: false });

  async function load() {
    const res = await listSaasUsers({ data: { q, status, page: 1 } });
    setRows(res.users);
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load users"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);

  return (
    <div>
      <PageHead
        eyebrow="Platform"
        title="Users"
        hint="Every operator login. Passwords and OTPs are never shown."
        actions={
          <Button type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Create user"}
          </Button>
        }
      />
      {open ? (
        <form
          className="mb-6 grid gap-3 rounded-xl bg-surface p-5 shadow-card sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await createSaasUser({ data: form });
              setForm({ email: "", name: "", password: "", phone: "", platform_admin: false });
              setOpen(false);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not create user");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Password">
            <Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <label className="flex h-11 items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.platform_admin} onChange={(e) => setForm({ ...form, platform_admin: e.target.checked })} />
            Superadmin
          </label>
          <Button type="submit" disabled={busy} className="sm:col-span-2">
            {busy ? "Creating…" : "Create user"}
          </Button>
        </form>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input placeholder="Search email, name, phone" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DISABLED">Disabled</option>
        </Select>
      </div>
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      <Panel>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wider text-subtle">
              <th className="py-2">User</th>
              <th>Status</th>
              <th>Last login</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/70">
                <td className="py-3">
                  <Link to="/platform/users/$userId" params={{ userId: row.id }} className="font-medium hover:underline">
                    {row.name || row.email}
                  </Link>
                  <div className="text-xs text-muted">{row.email}{row.platform_admin ? " · Superadmin" : ""}</div>
                </td>
                <td>{row.status}</td>
                <td className="text-xs">{row.last_login_at ? nairobiTime(row.last_login_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
