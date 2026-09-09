import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, getBearerToken, signIn } from "@/lib/auth/client";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { hasOperatorBearer, loginPageAction, rememberAuthSession } from "@/lib/isp/auth-session";
import { bootstrapWorkspace } from "@/lib/isp/server";

export const Route = createFileRoute("/login")({ component: Login });

const subscribeToNothing = () => () => {};

function Login() {
  const { user, isPending } = useCurrentUserState();
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    () => false,
  );
  const [name, setName] = useState("");
  const [ispName, setIspName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const action = loginPageAction({
    isPending,
    hasUser: Boolean(user),
    hasOperatorBearer: hasOperatorBearer() || Boolean(getBearerToken()),
    hasGateSession: gateSession,
  });

  if (action === "go_app") return <Navigate to="/app" />;

  const switching = Boolean(user && gateSession);

  async function onEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fetchOptions = {
        onSuccess: (ctx: { data?: { token?: string | null }; response: Response }) => {
          rememberAuthSession({ data: ctx.data }, ctx.response.headers);
        },
      };
      if (mode === "up") {
        const result = await authClient.signUp.email({
          email,
          password,
          name: name.trim() || email.split("@")[0] || "Operator",
          fetchOptions,
        });
        if (result.error) throw new Error(result.error.message || "Could not create the account");
        rememberAuthSession(result);
        try {
          await bootstrapWorkspace({ data: { isp_name: ispName.trim() } });
        } catch {
          /* first /app load also provisions the workspace */
        }
      } else {
        const result = await authClient.signIn.email({ email, password, fetchOptions });
        if (result.error) throw new Error(result.error.message || "Invalid email or password");
        rememberAuthSession(result);
      }
      window.location.assign("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-md bg-accent text-accent-fg">
            <Activity className="size-4" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Gridline</span>
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "up" ? "Create your ISP" : "Sign in to your ISP"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {mode === "up"
            ? "Your email and password become the owner login for this workspace."
            : switching
              ? "Enter the email and password from signup or the login your superadmin created. That account replaces this Grok view."
              : "Use the email and password from signup, or the owner/staff login your superadmin created."}
        </p>

        {authEnabled ? (
          <div className="mt-6 space-y-3">
            {!switching && GROK_PROVIDERS.length > 0 ? (
              <>
                {GROK_PROVIDERS.map((p) => (
                  <Button
                    key={p.providerId}
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => signIn(p.providerId, { callbackURL: "/app" })}
                  >
                    Continue with {p.label}
                  </Button>
                ))}
                <div className="relative py-2 text-center text-xs text-subtle">
                  <span className="bg-bg px-2">or email</span>
                  <div className="absolute top-1/2 right-0 left-0 -z-10 h-px bg-border" />
                </div>
              </>
            ) : null}
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
                </>
              ) : null}
              <Field label="Email">
                <Input
                  type="email"
                  required
                  placeholder="you@isp.co.ke"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
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
