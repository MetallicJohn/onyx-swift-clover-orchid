import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/isp/portal-shell";
import { usePublicTheme } from "@/components/theme-provider";
import { AppErrorComponent } from "@/lib/error-component";
import type { PortalHome } from "@/lib/isp/customer-portal-dto";
import { GateCtx, PortalCtx, type PortalGate } from "@/lib/isp/portal-context";
import { clearPortalSession, onPortalSession, readPortalSession, writePortalSession } from "@/lib/isp/portal-session";
import { getPortalHome, portalSignOut } from "@/lib/isp/server-portal";

export const Route = createFileRoute("/portal")({
  component: PortalLayout,
  errorComponent: PortalRouteError,
});

function OpeningAccount() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg text-sm text-muted">
      Opening your account…
    </div>
  );
}

function PortalRouteError({ error, reset }: ErrorComponentProps) {
  if (!(error instanceof Error) || (error.message !== "Not signed in" && error.message !== "Portal unavailable")) {
    return <AppErrorComponent error={error} reset={reset} />;
  }
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-4 text-center text-fg">
      <p className="text-lg font-semibold tracking-tight">Continue to your account</p>
      <p className="max-w-sm text-sm text-muted">Your session is ready. Open the portal to pick up where you left off.</p>
      <a href="/portal/" className="mt-2 text-sm font-medium text-accent hover:underline">
        Open account
      </a>
    </main>
  );
}

function PortalLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [token, setToken] = useState("");
  const [slug, setSlug] = useState("");
  const [home, setHome] = useState<PortalHome | null>(null);
  const [boot, setBoot] = useState(() => typeof window !== "undefined" && Boolean(readPortalSession()?.token));
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

  const establish = useCallback(async (nextToken: string, nextSlug: string) => {
    writePortalSession({ token: nextToken, slug: nextSlug });
    setSlug(nextSlug);
    setBoot(true);
    try {
      const data = await getPortalHome({ data: { token: nextToken } });
      setHome(data);
      setToken(nextToken);
    } catch (err) {
      clearPortalSession();
      setToken("");
      setHome(null);
      throw err;
    } finally {
      setBoot(false);
    }
  }, []);

  const signOut = useCallback(() => {
    const t = token;
    clearPortalSession();
    setToken("");
    setHome(null);
    if (t) void portalSignOut({ data: { token: t } }).catch(() => undefined);
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return onPortalSession(() => {
      const stored = readPortalSession();
      if (!stored?.token) {
        setToken("");
        setHome(null);
        setBoot(false);
        return;
      }
      setBoot(true);
      void refresh();
    });
  }, [refresh]);

  const session = useMemo(
    () => (token && home ? { token, slug, home, refresh, signOut } : null),
    [token, slug, home, refresh, signOut],
  );
  const gate = useMemo<PortalGate>(() => ({ establish }), [establish]);
  const onLogin = pathname === "/portal" || pathname === "/portal/";
  const authed = Boolean(session);

  return (
    <GateCtx.Provider value={gate}>
      <PortalCtx.Provider value={session}>
        {authed && session && home ? (
          <PortalShell
            session={{
              token: session.token,
              slug: session.slug,
              name: home.customer.name,
              isp: branding?.displayName || home.isp.name,
              logo: branding?.logo,
            }}
            onSignOut={signOut}
          />
        ) : onLogin ? (
          <div className="relative min-h-dvh bg-bg text-fg">
            <Outlet />
            {boot ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg text-sm text-muted">
                Opening your account…
              </div>
            ) : null}
          </div>
        ) : boot ? (
          <OpeningAccount />
        ) : (
          <Navigate to={"/portal" as never} />
        )}
      </PortalCtx.Provider>
    </GateCtx.Provider>
  );
}
