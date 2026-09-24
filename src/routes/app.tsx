import { createFileRoute, Navigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useTheme } from "@/components/theme-provider";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getDashboard, listMyTenants, switchTenant } from "@/lib/isp/server";
import { platformStatus } from "@/lib/isp/server-more";
import { getTenantTheme } from "@/lib/isp/server-theme";
import { setActiveDateFormat } from "@/lib/isp/display";
import { clearThemeCache, type ThemeConfig } from "@/lib/theme/resolve";
import { usePlatformIdentity } from "@/lib/isp/use-platform-session";
import type { Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app")({ component: AppLayout });

function AppLayout() {
  const { user, isPending } = useCurrentUserState();
  const platformCheck = authEnabled && Boolean(user) && !isPending;
  const platform = usePlatformIdentity(platformCheck);
  const { apply } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
        setActiveDateFormat(d.workspace.dateFormat);
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

  if (isPending || (platformCheck && platform.state === "pending")) {
    return <div className="min-h-dvh bg-bg" />;
  }
  if (!user || (authEnabled && platform.state !== "ok")) return <RedirectToSignIn />;
  if (platformOnly && (pathname === "/app/profile" || pathname.startsWith("/app/profile/"))) {
    return <AppShell platformAdmin displayName="SaaS Management" tenantName="ISP Solutions" />;
  }
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
        setActiveDateFormat(ws.dateFormat);
        setActiveTenantId(id);
        window.location.reload();
      }}
      platformAdmin={platformAdmin}
      tenantStatus={workspace?.status}
      supportMode={workspace?.supportMode}
      supportReason={workspace?.supportReason}
      accountEmail={platform.identity?.email}
      accountStatus={platform.identity?.status}
    />
  );
}