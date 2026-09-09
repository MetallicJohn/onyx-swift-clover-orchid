import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, v as Link, x as require_jsx_runtime, y as Navigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as hasGateSessionMarker, t as GROK_PROVIDERS } from "./server-BZunXvKg.mjs";
import { C as Activity } from "../_libs/lucide-react.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, t as Field } from "./input-BJCOk2ZM.mjs";
import { n as bootstrapWorkspace } from "./server-C1t-C6za.mjs";
import { i as signIn, r as getBearerToken, t as authClient } from "./client-BXBOTlUB.mjs";
import { n as useCurrentUserState } from "./use-current-user-cIszCLdV.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/login-5Vq8Cez5.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
/** Same key `src/lib/auth/client.ts` reads for live-preview bearer sessions. */
var BEARER_KEY = "grok-auth.bearer-token";
/**
* Prefer the signed `set-auth-token` header (cookie value). Fall back to the
* unsigned body token — Better Auth's bearer plugin will sign that.
*/
function sessionTokenFromAuthResponse(result, headers) {
	const fromHeader = headers?.get("set-auth-token")?.trim() || "";
	const fromBody = result.data?.token?.trim() || "";
	return fromHeader || fromBody;
}
function hasOperatorBearer() {
	if (typeof window === "undefined") return false;
	try {
		return Boolean(window.sessionStorage.getItem(BEARER_KEY)?.trim());
	} catch {
		return false;
	}
}
/** Keep the email/password session in the preview iframe (gate would otherwise replace it). */
function rememberAuthSession(result, headers) {
	if (typeof window === "undefined") return;
	const token = sessionTokenFromAuthResponse(result, headers);
	if (!token) return;
	try {
		window.sessionStorage.setItem(BEARER_KEY, token);
	} catch {}
}
/**
* Gate (Grok viewer) sessions must not hide ISP email login. Operator bearer
* or a normal cookie session can skip the form.
*/
function loginPageAction(input) {
	if (input.isPending) return "wait";
	if (!input.hasUser) return "form";
	if (input.hasOperatorBearer) return "go_app";
	if (input.hasGateSession) return "form";
	return "go_app";
}
var subscribeToNothing = () => () => {};
function Login() {
	const { user, isPending } = useCurrentUserState();
	const gateSession = (0, import_react.useSyncExternalStore)(subscribeToNothing, hasGateSessionMarker, () => false);
	const [name, setName] = (0, import_react.useState)("");
	const [ispName, setIspName] = (0, import_react.useState)("");
	const [email, setEmail] = (0, import_react.useState)("");
	const [password, setPassword] = (0, import_react.useState)("");
	const [mode, setMode] = (0, import_react.useState)("in");
	const [error, setError] = (0, import_react.useState)(null);
	const [busy, setBusy] = (0, import_react.useState)(false);
	if (loginPageAction({
		isPending,
		hasUser: Boolean(user),
		hasOperatorBearer: hasOperatorBearer() || Boolean(getBearerToken()),
		hasGateSession: gateSession
	}) === "go_app") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigate, { to: "/app" });
	const switching = Boolean(user && gateSession);
	async function onEmail(e) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const fetchOptions = { onSuccess: (ctx) => {
				rememberAuthSession({ data: ctx.data }, ctx.response.headers);
			} };
			if (mode === "up") {
				const result = await authClient.signUp.email({
					email,
					password,
					name: name.trim() || email.split("@")[0] || "Operator",
					fetchOptions
				});
				if (result.error) throw new Error(result.error.message || "Could not create the account");
				rememberAuthSession(result);
				try {
					await bootstrapWorkspace({ data: { isp_name: ispName.trim() } });
				} catch {}
			} else {
				const result = await authClient.signIn.email({
					email,
					password,
					fetchOptions
				});
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
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grid min-h-dvh place-items-center bg-bg px-4",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-sm",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
					to: "/",
					className: "mb-8 flex items-center gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "grid size-9 place-items-center rounded-md bg-accent text-accent-fg",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Activity, { className: "size-4" })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-lg font-semibold tracking-tight",
						children: "Gridline"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-2xl font-semibold tracking-tight",
					children: mode === "up" ? "Create your ISP" : "Sign in to your ISP"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted",
					children: mode === "up" ? "Your email and password become the owner login for this workspace." : switching ? "Enter the email and password from signup or the login your superadmin created. That account replaces this Grok view." : "Use the email and password from signup, or the owner/staff login your superadmin created."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-6 space-y-3",
					children: [
						!switching && GROK_PROVIDERS.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [GROK_PROVIDERS.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							type: "button",
							variant: "secondary",
							className: "w-full",
							onClick: () => signIn(p.providerId, { callbackURL: "/app" }),
							children: ["Continue with ", p.label]
						}, p.providerId)), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "relative py-2 text-center text-xs text-subtle",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "bg-bg px-2",
								children: "or email"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute top-1/2 right-0 left-0 -z-10 h-px bg-border" })]
						})] }) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
							className: "grid gap-3",
							onSubmit: onEmail,
							children: [
								mode === "up" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
									label: "Your name",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
										required: true,
										placeholder: "Jane Wanjiku",
										value: name,
										onChange: (e) => setName(e.target.value),
										autoComplete: "name",
										name: "name"
									})
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
									label: "ISP name",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
										required: true,
										placeholder: "Imani Networks",
										value: ispName,
										onChange: (e) => setIspName(e.target.value),
										name: "isp_name"
									})
								})] }) : null,
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
									label: "Email",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
										type: "email",
										required: true,
										placeholder: "you@isp.co.ke",
										value: email,
										onChange: (e) => setEmail(e.target.value),
										autoComplete: "email",
										name: "email"
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
									label: "Password",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
										type: "password",
										required: true,
										minLength: 8,
										placeholder: "At least 8 characters",
										value: password,
										onChange: (e) => setPassword(e.target.value),
										autoComplete: mode === "up" ? "new-password" : "current-password",
										name: "password"
									})
								}),
								error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-sm text-danger",
									children: error
								}) : null,
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "submit",
									className: "w-full",
									disabled: busy,
									children: busy ? "Please wait…" : mode === "up" ? "Create account" : "Sign in"
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "w-full text-center text-sm text-muted hover:text-fg",
							onClick: () => {
								setMode(mode === "up" ? "in" : "up");
								setError(null);
							},
							children: mode === "up" ? "Already have an account? Sign in" : "New ISP? Create an account"
						}),
						switching ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/app",
							className: "block w-full text-center text-sm text-muted hover:text-fg",
							children: "Stay in the current console"
						}) : null
					]
				})
			]
		})
	});
}
//#endregion
export { Login as component };
