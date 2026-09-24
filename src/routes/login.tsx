import { createFileRoute, Link, Navigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState, useSyncExternalStore } from "react";
import { authClient, authEnabled, getBearerToken } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { BrandMark } from "@/components/isp/brand-mark";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { usePublicTheme } from "@/components/theme-provider";
import { APP_NAME } from "@/lib/brand";
import { hasOperatorBearer, loginPageAction, rememberAuthSession } from "@/lib/isp/auth-session";
import { bootstrapWorkspace, prepareOperatorSignIn } from "@/lib/isp/server";
import { loginDestination, loginModeFromSearch, normalizeLoginEmail, signInErrorMessage } from "@/lib/isp/login-next";
import { usePlatformIdentity } from "@/lib/isp/use-platform-session";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string; mode?: string; isp?: string } => ({
    next: typeof search.next === "string" && search.next ? search.next : undefined,
    mode: typeof search.mode === "string" && search.mode ? search.mode : undefined,
    isp: typeof search.isp === "string" && search.isp ? search.isp : undefined,
  }),
  component: Login,
});

const subscribeToNothing = () => () => {};

function Login() {
  const { user, isPending } = useCurrentUserState();
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const ispSlug = useMemo(() => new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("isp") ?? "", [search]);
  const { branding } = usePublicTheme(ispSlug, "login");
  const brandName = branding?.displayName || APP_NAME;
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    () => false,
  );
  const [name, setName] = useState("");
  const [ispName, setIspName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">(() => loginModeFromSearch(search));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dest = loginDestination(search, mode, email);
  const platformIntent = dest === "/platform" && mode === "in";
  const platformCheck = authEnabled && Boolean(user) && !isPending;
  const platform = usePlatformIdentity(platformCheck);

  const action = loginPageAction({
    isPending,
    hasUser: Boolean(user),
    hasOperatorBearer: hasOperatorBearer() || Boolean(getBearerToken()),
    hasGateSession: gateSession,
    platformPending: platformCheck && platform.state === "pending",
    platformOk: authEnabled ? platform.state === "ok" : Boolean(user),
  });

  if (action === "go_app") return <Navigate to={dest} />;

  const switching = Boolean(user && gateSession);

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const loginEmail = normalizeLoginEmail(email);
      const fetchOptions = {
        onSuccess: (ctx: { data?: { token?: string | null }; response: Response }) => {
          rememberAuthSession({ data: ctx.data }, ctx.response.headers);
        },
      };
      if (mode === "up") {
        const result = await authClient.signUp.email({
          email: loginEmail,
          password,
          name: name.trim() || loginEmail.split("@")[0] || "Operator",
          fetchOptions,
        });
        if (result.error) throw new Error(result.error.message || "Could not create the account");
        rememberAuthSession(result);
        try {
          await bootstrapWorkspace({ data: { isp_name: ispName.trim(), phone: phone.trim() } });
        } catch (err) {
          throw err instanceof Error ? err : new Error("Could not start the workspace");
        }
      } else {
        try {
          await prepareOperatorSignIn({ data: { email: loginEmail } });
        } catch (err) {
          try {
            const { noteOperatorSignIn } = await import("@/lib/isp/server");
            await noteOperatorSignIn({ data: { email: loginEmail, ok: false } });
          } catch {
            /* audit is best-effort */
          }
          throw err instanceof Error ? err : new Error("Invalid username or password");
        }
        const result = await authClient.signIn.email({ email: loginEmail, password, fetchOptions });
        if (result.error) {
          try {
            const { noteOperatorSignIn } = await import("@/lib/isp/server");
            await noteOperatorSignIn({ data: { email: loginEmail, ok: false } });
          } catch {
            /* audit is best-effort */
          }
          throw new Error(result.error.message || "Invalid username or password");
        }
        rememberAuthSession(result);
        try {
          const { noteOperatorSignIn } = await import("@/lib/isp/server");
          await noteOperatorSignIn({ data: { email: loginEmail, ok: true } });
        } catch {
          /* audit is best-effort */
        }
      }
      window.location.assign(dest);
    } catch (err) {
      setError(signInErrorMessage(err, APP_NAME));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <BrandMark name={brandName} logo={branding?.logo} size={36} />
          <span className="text-lg font-semibold tracking-tight">{brandName}</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "up" ? "Create your ISP" : platformIntent ? "Sign in to the platform" : "Sign in to your ISP"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {mode === "up"
            ? "Your email, mobile number, and password become the owner login. One free trial per email or phone — after that you choose a paid plan."
            : switching
              ? "Sign in with the email and password for your ISP Solutions account."
              : platformIntent
                ? "Use the platform administrator username and password. Tenant consoles stay separate."
                : "Use the email and password from signup, or the staff login created in ISP Solutions."}
        </p>

        {authEnabled ? (
          <div className="mt-6 space-y-3">
            <form className="grid gap-3" onSubmit={onEmail}>
              {mode === "up" ? (
                <>
                  <Field label="Your name">
                    <Input
                      required
                      placeholder="Jane Wanjiku"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      name="name"
                    />
                  </Field>
                  <Field label="ISP name">
                    <Input
                      required
                      placeholder="Imani Networks"
                      value={ispName}
                      onChange={(e) => setIspName(e.target.value)}
                      name="isp_name"
                    />
                  </Field>
                  <Field label="Mobile number">
                    <Input
                      type="tel"
                      required
                      inputMode="tel"
                      placeholder="0712 000 000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                      name="phone"
                    />
                  </Field>
                </>
              ) : null}
              <Field label={mode === "in" ? "Email or username" : "Email"}>
                <Input
                  type={mode === "up" ? "email" : "text"}
                  required
                  placeholder={mode === "in" ? "you@isp.co.ke" : "you@isp.co.ke"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  name="email"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "up" ? "new-password" : "current-password"}
                  name="password"
                />
              </Field>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Please wait…" : mode === "up" ? "Create account" : "Sign in"}
              </Button>
            </form>
            {mode === "in" ? (
              <Link to="/forgot-password" className="block w-full text-center text-sm text-muted hover:text-fg">
                Forgot password?
              </Link>
            ) : null}
            <button
              type="button"
              className="w-full text-center text-sm text-muted hover:text-fg"
              onClick={() => {
                setMode(mode === "up" ? "in" : "up");
                setError(null);
              }}
            >
              {mode === "up" ? "Already have an account? Sign in" : "New ISP? Create an account"}
            </button>
            {switching ? (
              <Link to="/app" className="block w-full text-center text-sm text-muted hover:text-fg">
                Stay in the current console
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">Sign-in is disabled.</p>
        )}
      </div>
    </main>
  );
}
