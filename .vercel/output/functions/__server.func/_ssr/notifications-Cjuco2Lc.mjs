import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as statusTone, t as Badge } from "./badge--5OIWgEt.mjs";
import { t as Button } from "./button-CL6xUAzZ.mjs";
import { i as Textarea, n as Input, t as Field } from "./input-D9suXaeu.mjs";
import { E as updateNotificationTemplate, S as runAutomatedBilling, m as listNotifications } from "./server-Dc13Q75o.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/notifications-Cjuco2Lc.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function NotificationsPage() {
	const [logs, setLogs] = (0, import_react.useState)([]);
	const [templates, setTemplates] = (0, import_react.useState)([]);
	const [inbox, setInbox] = (0, import_react.useState)([]);
	const [tab, setTab] = (0, import_react.useState)("log");
	const [cycle, setCycle] = (0, import_react.useState)(null);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [edit, setEdit] = (0, import_react.useState)(null);
	async function load() {
		const res = await listNotifications();
		setLogs(res.logs);
		setTemplates(res.templates);
		setInbox(res.inbox);
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	async function runCycle() {
		setBusy(true);
		setCycle(null);
		try {
			const r = await runAutomatedBilling();
			setCycle(`Due ${r.due} · overdue ${r.overdue} · grace ${r.grace} · suspended ${r.suspended} · notices ${r.notices}`);
			await load();
		} catch (e) {
			setCycle(e instanceof Error ? e.message : "Cycle failed");
		} finally {
			setBusy(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-2xl font-semibold tracking-tight",
					children: "Notifications"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "Automated billing messages over SMS, WhatsApp, email, and in-app. Templates are per tenant. Delivery is logged and de-duplicated so retries never double-send."
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					onClick: () => void runCycle(),
					disabled: busy,
					children: busy ? "Running…" : "Run billing cycle"
				})]
			}),
			cycle ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-accent",
				children: cycle
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: tab === "log" ? "default" : "secondary",
						onClick: () => setTab("log"),
						children: "Delivery log"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: tab === "templates" ? "default" : "secondary",
						onClick: () => setTab("templates"),
						children: "Templates"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: tab === "inbox" ? "default" : "secondary",
						onClick: () => setTab("inbox"),
						children: "In-app inbox"
					})
				]
			}),
			tab === "log" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "space-y-3",
				children: [logs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "No messages yet. Issue an invoice or run the cycle."
				}) : null, logs.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-start justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-medium",
							children: n.subject
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-1 text-xs text-muted",
							children: [
								n.event_code,
								" · ",
								n.channel,
								" · ",
								n.customer_name ?? "tenant",
								" · ",
								n.destination
							]
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							tone: statusTone(n.status),
							children: n.status
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 whitespace-pre-wrap text-sm text-muted",
						children: n.body
					})]
				}, n.id))]
			}) : tab === "templates" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "text-xs text-subtle",
					children: [
						"Variables: ",
						"{customer_name}",
						" ",
						"{invoice_number}",
						" ",
						"{amount}",
						" ",
						"{due_date}",
						" ",
						"{service_name}",
						" ",
						"{payment_reference}",
						" ",
						"{isp_name}"
					]
				}), templates.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-center justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-medium",
							children: t.event_code
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs text-muted uppercase",
							children: t.channel
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
								tone: t.enabled ? "ok" : "muted",
								children: t.enabled ? "on" : "off"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								size: "sm",
								variant: "secondary",
								onClick: () => setEdit(t),
								children: "Edit"
							})]
						})]
					}), edit?.id === t.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "mt-4 grid gap-3",
						onSubmit: async (e) => {
							e.preventDefault();
							await updateNotificationTemplate({ data: {
								id: t.id,
								subject: edit.subject,
								body: edit.body,
								enabled: edit.enabled
							} });
							setEdit(null);
							await load();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Subject",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									value: edit.subject,
									onChange: (e) => setEdit({
										...edit,
										subject: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Body",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
									value: edit.body,
									onChange: (e) => setEdit({
										...edit,
										body: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex items-center gap-2 text-sm text-muted",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: edit.enabled,
									onChange: (e) => setEdit({
										...edit,
										enabled: e.target.checked
									})
								}), "Enabled"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "submit",
									size: "sm",
									children: "Save"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "button",
									size: "sm",
									variant: "ghost",
									onClick: () => setEdit(null),
									children: "Cancel"
								})]
							})
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: t.body
					})]
				}, t.id))]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "space-y-3",
				children: [inbox.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "No in-app messages yet."
				}) : null, inbox.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-medium",
							children: n.subject
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-1 text-xs text-muted",
							children: [
								n.customer_name ?? "customer",
								" · ",
								n.event_code
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-sm text-muted",
							children: n.body
						})
					]
				}, n.id))]
			})
		]
	});
}
//#endregion
export { NotificationsPage as component };
