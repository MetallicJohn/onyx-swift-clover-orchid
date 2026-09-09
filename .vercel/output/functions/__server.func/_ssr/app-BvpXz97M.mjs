import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, d as useRouterState, m as Outlet, v as Link, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as cn } from "./rls-stkZtAMF.mjs";
import { S as Activity, _ as CreditCard, a as Users, b as Bell, c as Ticket, d as Settings, f as Router, g as Handshake, h as LayoutDashboard, l as Sparkles, m as Menu, n as Wrench, o as Upload, p as Radio, r as Wifi, t as X, v as ChartColumn, y as Boxes } from "../_libs/lucide-react.mjs";
import { T as switchTenant, l as getDashboard, p as listMyTenants } from "./server-Dc13Q75o.mjs";
import { n as useCurrentUserState } from "./use-current-user-ClOiUQ-z.mjs";
import { i as UserButton, t as RedirectToSignIn } from "./gates-CxGh1ZUC.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/app-BvpXz97M.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var NAV = [
	{
		to: "/app",
		label: "Overview",
		icon: LayoutDashboard
	},
	{
		to: "/app/customers",
		label: "Customers",
		icon: Users
	},
	{
		to: "/app/packages",
		label: "Packages",
		icon: Boxes
	},
	{
		to: "/app/services",
		label: "Services",
		icon: Wifi
	},
	{
		to: "/app/radius",
		label: "RADIUS",
		icon: Radio
	},
	{
		to: "/app/hotspot",
		label: "Hotspot",
		icon: Wifi
	},
	{
		to: "/app/billing",
		label: "Billing",
		icon: CreditCard
	},
	{
		to: "/app/reports",
		label: "Reports",
		icon: ChartColumn
	},
	{
		to: "/app/statements",
		label: "Statements",
		icon: CreditCard
	},
	{
		to: "/app/notifications",
		label: "Notifications",
		icon: Bell
	},
	{
		to: "/app/routers",
		label: "Routers",
		icon: Router
	},
	{
		to: "/app/acs",
		label: "GenieACS",
		icon: Activity
	},
	{
		to: "/app/ai",
		label: "AI MikroTik",
		icon: Sparkles
	},
	{
		to: "/app/field",
		label: "Field",
		icon: Wrench
	},
	{
		to: "/app/tickets",
		label: "Tickets",
		icon: Ticket
	},
	{
		to: "/app/partners",
		label: "Partners",
		icon: Handshake
	},
	{
		to: "/app/import",
		label: "Import",
		icon: Upload
	},
	{
		to: "/app/settings",
		label: "Settings",
		icon: Settings
	}
];
function AppShell({ tenantName, role, tenants, activeTenantId, onSwitchTenant }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const [open, setOpen] = (0, import_react.useState)(false);
	const Nav = () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
		className: "flex flex-col gap-0.5",
		children: NAV.map((item) => {
			const active = item.to === "/app" ? pathname === "/app" : pathname.startsWith(item.to);
			const Icon = item.icon;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				to: item.to,
				onClick: () => setOpen(false),
				className: cn("flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors", active ? "bg-elevated text-fg" : "text-muted hover:bg-elevated/60 hover:text-fg"),
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
					className: "size-4 shrink-0",
					strokeWidth: 1.75
				}), item.label]
			}, item.to);
		})
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-dvh bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface p-4 md:flex",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/app",
						className: "mb-6 flex items-center gap-2 px-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "grid size-8 place-items-center rounded-md bg-accent text-accent-fg",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Activity, { className: "size-4" })
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-sm font-semibold tracking-tight",
							children: "Gridline"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "max-w-36 truncate text-[11px] text-muted",
							children: tenantName ?? "ISP console"
						})] })]
					}),
					tenants && tenants.length > 1 && onSwitchTenant ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
						className: "mb-4 h-11 w-full rounded-md border border-border bg-bg px-2 text-sm",
						value: activeTenantId,
						onChange: (e) => onSwitchTenant(e.target.value),
						children: tenants.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: t.id,
							children: t.name
						}, t.id))
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Nav, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-auto border-t border-border pt-3 text-[11px] uppercase tracking-wider text-subtle",
						children: role?.replace("_", " ")
					})
				]
			}),
			open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "fixed inset-0 z-40 md:hidden",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "absolute inset-0 bg-bg/70",
					"aria-label": "Close menu",
					onClick: () => setOpen(false)
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "relative z-10 flex h-full w-64 flex-col bg-surface p-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mb-4 flex items-center justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-semibold",
							children: "Gridline"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "grid size-11 place-items-center",
							onClick: () => setOpen(false),
							"aria-label": "Close",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-5" })
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Nav, {})]
				})]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "md:pl-60",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
					className: "sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "grid size-11 place-items-center md:hidden",
							onClick: () => setOpen(true),
							"aria-label": "Open menu",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Menu, { className: "size-5" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "hidden text-sm text-muted md:block",
							children: "Operations"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserButton, {})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
					className: "p-4 md:p-6",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {})
				})]
			})
		]
	});
}
function AppLayout() {
	const { user, isPending } = useCurrentUserState();
	const [workspace, setWorkspace] = (0, import_react.useState)(null);
	const [tenants, setTenants] = (0, import_react.useState)([]);
	const [activeTenantId, setActiveTenantId] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		if (!user) return;
		let cancelled = false;
		Promise.all([getDashboard(), listMyTenants()]).then(([d, t]) => {
			if (cancelled) return;
			setWorkspace(d.workspace);
			setTenants(t.tenants);
			setActiveTenantId(t.activeId || d.workspace.tenantId);
		}).catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [user]);
	if (isPending) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "min-h-dvh bg-bg" });
	if (!user) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RedirectToSignIn, {});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		tenantName: workspace?.tenantName,
		role: workspace?.role,
		tenants,
		activeTenantId,
		onSwitchTenant: async (id) => {
			const ws = await switchTenant({ data: { tenant_id: id } });
			setWorkspace(ws);
			setActiveTenantId(id);
			window.location.reload();
		}
	});
}
//#endregion
export { AppLayout as component };
