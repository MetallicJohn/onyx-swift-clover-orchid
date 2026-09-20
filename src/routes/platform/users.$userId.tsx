import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { PageHead, Panel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import {
  forceSaasUserPassword,
  getSaasUser,
  revokeSaasUserSessions,
  updateSaasUser,
} from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/users/$userId")({ component: UserDetailPage });

function UserDetailPage() {
  const { userId } = Route.useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof getSaasUser>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");

  async function load() {
    setData(await getSaasUser({ data: { user_id: userId } }));
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load user"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const p = data?.profile;

  return (
    <div>
      <PageHead
        eyebrow="Users"
        title={p?.display_name || p?.email || "User"}
        hint="Passwords and OTPs are never displayed."
        actions={
          <Link to="/platform/users" className="text-sm text-accent hover:underline">
            All users
          </Link>
        }
      />
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      {ok ? <p className="mb-3 text-sm text-ok">{ok}</p> : null}
      {p ? (
        <Panel>
          <form
            className="grid max-w-xl gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              setOk(null);
              try {
                await updateSaasUser({
                  data: {
                    user_id: userId,
                    first_name: p.first_name,
                    last_name: p.last_name,
                    display_name: p.display_name,
                    phone: p.phone,
                    status: p.status,
                    platform_admin: p.platform_admin,
                  },
                });
                await load();
                setOk("User updated");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not save");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="First name">
              <Input value={p.first_name} onChange={(e) => setData({ ...data, profile: { ...p, first_name: e.target.value } })} />
            </Field>
            <Field label="Last name">
              <Input value={p.last_name} onChange={(e) => setData({ ...data, profile: { ...p, last_name: e.target.value } })} />
            </Field>
            <Field label="Display name">
              <Input value={p.display_name} onChange={(e) => setData({ ...data, profile: { ...p, display_name: e.target.value } })} />
            </Field>
            <Field label="Phone">
              <Input value={p.phone} onChange={(e) => setData({ ...data, profile: { ...p, phone: e.target.value } })} />
            </Field>
            <p className="text-sm text-muted">Email {p.email}</p>
            <Field label="Status">
              <Select value={p.status} onChange={(e) => setData({ ...data, profile: { ...p, status: e.target.value as typeof p.status } })}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
                <option value="DISABLED">DISABLED</option>
                <option value="PENDING_VERIFICATION">PENDING_VERIFICATION</option>
              </Select>
            </Field>
            <label className="flex h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={p.platform_admin}
                onChange={(e) => setData({ ...data, profile: { ...p, platform_admin: e.target.checked } })}
              />
              Superadmin
            </label>
            <p className="text-xs text-muted">
              Tenants: {p.tenants.map((t) => `${t.name} (${t.role})`).join(", ") || "none"}
            </p>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </form>
        </Panel>
      ) : null}
      <Panel className="mt-6">
        <h2 className="text-base font-semibold">Force password reset</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await forceSaasUserPassword({ data: { user_id: userId, password } });
              setPassword("");
              setOk("Password replaced. Existing sessions were signed out.");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not set password");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="New password">
            <Input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy}>
            Set password
          </Button>
        </form>
        <Button
          type="button"
          variant="danger"
          className="mt-4"
          onClick={async () => {
            setBusy(true);
            try {
              await revokeSaasUserSessions({ data: { user_id: userId } });
              await load();
              setOk("Sessions revoked");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not revoke");
            } finally {
              setBusy(false);
            }
          }}
        >
          Revoke sessions
        </Button>
      </Panel>
      <Panel className="mt-6">
        <h2 className="text-base font-semibold">Security events</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(data?.events || []).map((ev, i) => (
            <li key={`${ev.created_at}-${i}`}>
              <span className="font-mono text-xs">{nairobiTime(ev.created_at)}</span> {ev.action}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
