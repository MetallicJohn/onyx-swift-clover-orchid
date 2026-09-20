import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { getMyProfile, saveMyProfile } from "@/lib/isp/server";
import { nairobiTime } from "@/components/platform/format";

export const Route = createFileRoute("/app/profile")({ component: ProfilePage });

function ProfilePage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/app/profile") return <Outlet />;
  return <ProfileForm />;
}

function ProfileForm() {
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    display_name: "",
    phone: "",
    image: "",
    email: "",
    status: "",
    role: "",
    tenant: "",
    last_login_at: "",
    has_password: false,
    platform_admin: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile()
      .then((p) => {
        setForm({
          first_name: p.first_name,
          last_name: p.last_name,
          display_name: p.display_name,
          phone: p.phone,
          image: "",
          email: p.email,
          status: p.status,
          role: p.platform_admin ? "Superadmin" : p.tenants[0]?.role?.replaceAll("_", " ") || "Staff",
          tenant: p.tenants.map((t) => t.name).join(", ") || "—",
          last_login_at: p.last_login_at || "",
          has_password: p.has_password,
          platform_admin: p.platform_admin,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load profile"));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted">Personal information for this login. Role and tenant cannot be changed here.</p>
      </div>
      <form
        className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setOk(null);
          try {
            await saveMyProfile({
              data: {
                first_name: form.first_name,
                last_name: form.last_name,
                display_name: form.display_name,
                phone: form.phone,
                image: form.image || undefined,
              },
            });
            setOk("Profile saved");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="First name">
          <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </Field>
        <Field label="Last name">
          <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </Field>
        <Field label="Display name">
          <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0712 000 000" />
        </Field>
        <Field label="Profile image URL">
          <Input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="https://…" />
        </Field>
        <div className="grid gap-1 text-sm">
          <p><span className="text-muted">Email</span> — {form.email}</p>
          <p><span className="text-muted">Role</span> — {form.role}</p>
          <p><span className="text-muted">Tenant</span> — {form.tenant}</p>
          <p><span className="text-muted">Account status</span> — {form.status}</p>
          <p><span className="text-muted">Last login</span> — {form.last_login_at ? nairobiTime(form.last_login_at) : "—"}</p>
          <p><span className="text-muted">Password</span> — {form.has_password ? "Set" : "Not set — use forgot password"}</p>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {ok ? <p className="text-sm text-ok">{ok}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </Button>
          <Link to="/app/profile/security" className="inline-flex h-11 items-center text-sm text-accent hover:underline">
            Security and password
          </Link>
        </div>
      </form>
    </div>
  );
}
