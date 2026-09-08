import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { getDashboard, renameTenant } from "@/lib/isp/server";
import type { Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app/settings")({ component: SettingsPage });

function SettingsPage() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [form, setForm] = useState({ name: "", supportEmail: "", supportPhone: "" });

  async function load() {
    const d = await getDashboard();
    setWs(d.workspace);
    setForm({
      name: d.workspace.tenantName,
      supportEmail: d.workspace.supportEmail,
      supportPhone: d.workspace.supportPhone,
    });
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">Tenant branding. Packages live in their own module.</p>
      </div>

      <form
        className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await renameTenant({ data: form });
          await load();
        }}
      >
        <h2 className="font-medium">ISP profile</h2>
        <Field label="ISP name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Support email">
          <Input value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
        </Field>
        <Field label="Support phone">
          <Input value={form.supportPhone} onChange={(e) => setForm({ ...form, supportPhone: e.target.value })} />
        </Field>
        <p className="text-xs text-subtle">
          Role: {ws?.role} · Plan: {ws?.status}
        </p>
        <Button type="submit">Save</Button>
      </form>

      <p className="text-sm text-muted">
        Create and edit PPPoE, static, and hotspot packages in{" "}
        <Link to="/app/packages" className="text-accent hover:underline">
          Packages
        </Link>
        .
      </p>
    </div>
  );
}
