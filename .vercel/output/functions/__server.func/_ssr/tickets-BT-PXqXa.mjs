import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { h as listTickets, o as createTicket, y as setTicketStatus } from "./server-D7YxL8yv.mjs";
import { n as statusTone, t as Badge } from "./badge-z-BRSIMA.mjs";
import { t as Button } from "./button-C2DQffKf.mjs";
import { n as Input, r as Select, t as Field } from "./input-DvnPVGOJ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/tickets-BT-PXqXa.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var STATUSES = [
	"new",
	"assigned",
	"accepted",
	"travelling",
	"on_site",
	"waiting",
	"resolved",
	"closed"
];
function TicketsPage() {
	const [tickets, setTickets] = (0, import_react.useState)([]);
	const [customers, setCustomers] = (0, import_react.useState)([]);
	const [form, setForm] = (0, import_react.useState)({
		title: "",
		category: "performance",
		priority: "normal",
		customer_id: ""
	});
	async function load() {
		const res = await listTickets();
		setTickets(res.tickets);
		setCustomers(res.customers);
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Tickets"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Dispatch workflow for technicians — from new to on-site to resolved."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2",
				onSubmit: async (e) => {
					e.preventDefault();
					await createTicket({ data: form });
					setForm({
						...form,
						title: ""
					});
					await load();
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Title",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							required: true,
							value: form.title,
							onChange: (e) => setForm({
								...form,
								title: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Customer",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: form.customer_id,
							onChange: (e) => setForm({
								...form,
								customer_id: e.target.value
							}),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "",
								children: "Network / unassigned"
							}), customers.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: c.id,
								children: c.name
							}, c.id))]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Category",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: form.category,
							onChange: (e) => setForm({
								...form,
								category: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "performance",
									children: "Performance"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "billing",
									children: "Billing"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "network",
									children: "Network"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "hotspot",
									children: "Hotspot"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "install",
									children: "Installation"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Priority",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: form.priority,
							onChange: (e) => setForm({
								...form,
								priority: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "low",
									children: "Low"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "normal",
									children: "Normal"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "high",
									children: "High"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "urgent",
									children: "Urgent"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: "Create ticket"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "space-y-3",
				children: tickets.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-start justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-medium",
							children: t.title
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-1 text-xs text-muted",
							children: [
								t.customer_name ?? "Network",
								" · ",
								t.category,
								" · ",
								t.priority
							]
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							tone: statusTone(t.status),
							children: t.status.replace("_", " ")
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3 flex flex-wrap gap-1",
						children: STATUSES.filter((s) => s !== t.status).map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "sm",
							variant: "ghost",
							onClick: async () => {
								await setTicketStatus({ data: {
									id: t.id,
									status: s
								} });
								await load();
							},
							children: s.replace("_", " ")
						}, s))
					})]
				}, t.id))
			})
		]
	});
}
//#endregion
export { TicketsPage as component };
