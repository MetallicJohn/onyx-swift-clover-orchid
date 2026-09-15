import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { PortalShell } from "@/components/isp/portal-shell";
import { usePublicTheme } from "@/components/theme-provider";
import type { PortalHome } from "@/lib/isp/customer-portal-dto";
import { clearPortalSession, readPortalSession } from "@/lib/isp/portal-session";
import { getPortalHome, portalSignOut } from "@/lib/isp/server-portal";

type PortalState = {
  token: string;
  slug: string;
  home: PortalHome;
  refresh: () => Promise<void>;
  signOut: () => void;
};

const PortalCtx = createContext<PortalState | null>(null);

export function usePortal() {
  const v = useContext(PortalCtx);
  if (!v) throw new Error("Not signed in");
  return v;
}

export const Route = createFileRoute("/portal")({
  component: PortalLayout,
});

function PortalLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [token, setToken] = useState("");
  const [slug, setSlug] = useState("");
  const [home, setHome] = useState<PortalHome | null>(null);
  const [boot, setBoot] = useState(true);
  const { branding } = usePublicTheme(slug, "portal");

  const refresh = useCallback(async () => {
    const stored = readPortalSession();
    if (!stored?.token) {
      setHome(null);
      setToken("");
      setBoot(false);
      return;
    }
    setSlug(stored.slug);
    try {
      const data = await getPortalHome({ data: { token: stored.token } });
      setHome(data);
      setToken(stored.token);
    } catch {
      clearPortalSession();
      setToken("");
      setHome(null);
    } finally {
      setBoot(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function signOut() {
    const t = token;
    clearPortalSession();
    setToken("");
    setHome(null);
    if (t) void portalSignOut({ data: { token: t } }).catch(() => undefined);
  }

  if (boot) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-sm text-muted">
        Opening your account…
      </div>
    );
  }

  if (!token || !home) {
    const onLogin = pathname === "/portal" || pathname === "/portal/";
    if (!onLogin) return <Navigate to={"/portal" as never} />;
    return (
      <div className="min-h-dvh bg-bg text-fg">
        <Outlet />
      </div>
    );
  }

  return (
    <PortalCtx.Provider
      value={{
        token,
        slug,
        home,
        refresh,
        signOut,
      }}
    >
      <PortalShell
        session={{
          token,
          slug,
          name: home.customer.name,
          isp: branding?.displayName || home.isp.name,
          logo: branding?.logo,
        }}
        onSignOut={signOut}
      />
    </PortalCtx.Provider>
  );
}

