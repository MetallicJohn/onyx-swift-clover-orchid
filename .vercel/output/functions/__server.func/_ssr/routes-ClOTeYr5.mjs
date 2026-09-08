import { v as Link, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as Shield, h as Activity, m as ArrowRight, r as Wallet, u as Radio } from "../_libs/lucide-react.mjs";
import { n as useCurrentUserState } from "./use-current-user-DG6UNzh9.mjs";
import { n as SignedIn, r as SignedOut } from "./gates-BkyTowff.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-ClOTeYr5.js
var import_jsx_runtime = require_jsx_runtime();
function Home() {
	const { isPending } = useCurrentUserState();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "min-h-dvh bg-bg text-fg",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "mx-auto flex max-w-6xl items-center justify-between px-4 py-5",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "grid size-8 place-items-center rounded-md bg-accent text-accent-fg",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Activity, { className: "size-4" })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-semibold tracking-tight",
					children: "Gridline"
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex h-11 items-center gap-3 text-sm",
				children: [
					isPending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "size-8 animate-pulse rounded-full bg-elevated" }) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SignedOut, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/login",
						className: "text-muted hover:text-fg",
						children: "Sign in"
					}) }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SignedIn, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/app",
						className: "rounded-md bg-accent px-4 py-2 font-medium text-accent-fg",
						children: "Open console"
					}) })
				]
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "mx-auto max-w-6xl px-4 pt-10 pb-16 md:pt-20",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs font-medium tracking-[0.2em] text-accent uppercase",
					children: "ISP operations SaaS"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-4 max-w-3xl text-4xl leading-tight font-semibold tracking-tight md:text-6xl",
					children: "Run the network. Collect the money. Keep customers online."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-5 max-w-xl text-base leading-relaxed text-muted md:text-lg",
					children: "Multi-tenant billing, RADIUS-ready services, MikroTik via WireGuard agent, M-Pesa, and technician workflows — built for East African ISPs."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-8 flex flex-wrap gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SignedOut, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/login",
						className: "inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-fg",
						children: ["Start your ISP ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowRight, { className: "size-4" })]
					}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SignedIn, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/app",
						className: "inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-fg",
						children: ["Continue to console ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowRight, { className: "size-4" })]
					}) })]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-16 grid gap-4 md:grid-cols-3",
					children: [
						{
							icon: Wallet,
							title: "Billing that restores access",
							body: "Invoices, grace, suspension, and M-Pesa payments that automatically restore PPPoE and hotspot service."
						},
						{
							icon: Radio,
							title: "Routers stay private",
							body: "WireGuard agent model. No public Winbox or API ports. Inventory, health, and onboarding scripts."
						},
						{
							icon: Shield,
							title: "Tenant isolation first",
							body: "Every customer, invoice, and router is scoped to an ISP. Platform never mixes operator data."
						}
					].map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-xl border border-border bg-surface p-5",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(f.icon, { className: "size-5 text-accent" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "mt-4 text-lg font-medium",
								children: f.title
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-2 text-sm leading-relaxed text-muted",
								children: f.body
							})
						]
					}, f.title))
				})
			]
		})]
	});
}
//#endregion
export { Home as component };
