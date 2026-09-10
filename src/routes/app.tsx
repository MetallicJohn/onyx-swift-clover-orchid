import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useTheme } from "@/components/theme-provider";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getDashboard, listMyTenants, switchTenant } from "@/lib/isp/server";
import { platformStatus } from "@/lib/isp/server-more";
import { getTenantTheme } from "@/lib/isp/server-theme";
import { clearThemeCache, type ThemeConfig } from "@/lib/theme/resolve";
import type { Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app")({ component: AppLayout });

function AppLayout() {
  const { user, isPending } = useCurrentUserState();
  const { apply } = useTheme();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [activeTenantId, setActiveTenantId] = useState("");
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [platformOnly, setPlatformOnly] = useState(false);
  const [brand, setBrand] = useState<{ displayName: string; logo: string }>({ displayName: "", logo: "" });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([getDashboard(), listMyTenants(), platformStatus()])
      .then(([d, t, p]) => {
        if (cancelled) return;
        setWorkspace(d.workspace);
        setTenants(t.tenants);
        setActiveTenantId(t.activeId || d.workspace.tenantId);
        setPlatformAdmin(p.admin);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("SaaS Management") || msg.includes("No ISP workspace")) {
          if (!cancelled) setPlatformOnly(true);
        }
      });
    getTenantTheme()
      .then((theme) => {
        if (cancelled) return;
        setBrand({ displayName: theme.displayName || theme.name, logo: theme.logo });
        apply(theme as ThemeConfig, theme.name);
      })
      .catch(() => {
        /* keep stylesheet / cached tokens until the next successful load */
      });
    return () => {
      cancelled = true;
    };
  }, [user, apply]);

  useEffect(() => {
    return () => apply(null);
  }, [apply]);

  if (isPending) {
    return <div className="min-h-dvh bg-bg" />;
  }
  if (!user) return <RedirectToSignIn />;
  if (platformOnly) return <Navigate to="/platform" />;

  return (
    <AppShell
      tenantName={workspace?.tenantName}
      displayName={brand.displayName || workspace?.tenantName}
      logo={brand.logo}
      role={workspace?.role}
      tenants={tenants}
      activeTenantId={activeTenantId}
      onSwitchTenant={async (id) => {
        clearThemeCache();
        apply(null);
        const ws = await switchTenant({ data: { tenant_id: id } });
        setWorkspace(ws);
        setActiveTenantId(id);
        window.location.reload();
      }}
      platformAdmin={platformAdmin}
      tenantStatus={workspace?.status}
      supportMode={workspace?.supportMode}
      supportReason={workspace?.supportReason}
    />
  );
}