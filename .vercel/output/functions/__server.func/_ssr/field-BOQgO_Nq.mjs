import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { i as commentOpenTicket } from "./server-more-C5Y0MTly.mjs";
import { n as statusTone, t as Badge } from "./badge-BO-VQeJb.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { g as listField } from "./server-ops-Cjhg1W_o.mjs";
import { D as setTicketStatus } from "./server-C1t-C6za.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/field-BOQgO_Nq.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function FieldPage() {
	const [tickets, setTickets] = (0, import_react.useState)([]);
	async function load() {
		setTickets((await listField()).tickets);
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "text-2xl font-semibold tracking-tight",
			children: "Field"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-sm text-muted",
			children: "Technician jobs assigned to you. Accept, travel, arrive, close."
		})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid gap-3",
			children: [tickets.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "rounded-xl border border-border bg-surface p-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-start justify-between gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-medium",
							children: t.title
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-1 text-sm text-muted",
							children: [
								t.customer_name ?? "Network",
								" · ",
								t.phone ?? "—"
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs text-subtle",
							children: t.address
						})
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							tone: statusTone(t.priority),
							children: t.priority
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							tone: statusTone(t.status),
							children: t.status
						})]
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-3 flex flex-wrap gap-2",
					children: [[
						"accepted",
						"travelling",
						"on_site",
						"resolved"
					].map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: "secondary",
						onClick: async () => {
							await setTicketStatus({ data: {
								id: t.id,
								status: s
							} });
							await load();
						},
						children: s.replace("_", " ")
					}, s)), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: "ghost",
						onClick: async () => {
							await commentOpenTicket({ data: {
								id: t.id,
								body: "On site check-in"
							} });
						},
						children: "Check-in note"
					})]
				})]
			}, t.id)), tickets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "No open jobs."
			}) : null]
		})]
	});
}
//#endregion
export { FieldPage as component };
