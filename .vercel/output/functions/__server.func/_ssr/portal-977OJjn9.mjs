import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, v as Link, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { j as kes } from "./access-1saCIo2_.mjs";
import { C as Activity } from "../_libs/lucide-react.mjs";
import { n as statusTone, t as Badge } from "./badge-BO-VQeJb.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, t as Field } from "./input-BJCOk2ZM.mjs";
import { C as requestPortalOtp, S as portalPay, d as getPortalHome, j as verifyPortalLogin, x as portalOpenTicket } from "./server-ops-Cjhg1W_o.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/portal-977OJjn9.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function PortalHome() {
	const [slug, setSlug] = (0, import_react.useState)("");
	const [phone, setPhone] = (0, import_react.useState)("");
	const [code, setCode] = (0, import_react.useState)("");
	const [hint, setHint] = (0, import_react.useState)(null);
	const [token, setToken] = (0, import_react.useState)(null);
	const [home, setHome] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	const [ticket, setTicket] = (0, import_react.useState)("");
	async function refresh(t) {
		setHome(await getPortalHome({ data: { token: t } }));
	}
	if (!token || !home) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				to: "/",
				className: "mb-8 flex items-center gap-2 text-sm text-muted",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Activity, { className: "size-4 text-accent" }), " Gridline customer portal"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Pay bills & check your line"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: "Use your ISP slug and the phone on the account. Sandbox SMS uses code 000000; live SMS is sent to the phone."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "mt-6 grid gap-3",
				onSubmit: async (e) => {
					e.preventDefault();
					setError(null);
					try {
						if (!hint) {
							const r = await requestPortalOtp({ data: {
								slug,
								phone
							} });
							setHint(r.hint);
						} else {
							const r = await verifyPortalLogin({ data: {
								slug,
								phone,
								code
							} });
							setToken(r.token);
							await refresh(r.token);
						}
					} catch (ex) {
						setError(ex instanceof Error ? ex.message : "Failed");
					}
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Network slug",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							required: true,
							placeholder: "from Settings / your ISP URL",
							value: slug,
							onChange: (e) => setSlug(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Phone",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							required: true,
							placeholder: "0712…",
							value: phone,
							onChange: (e) => setPhone(e.target.value)
						})
					}),
					hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "OTP",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							required: true,
							value: code,
							onChange: (e) => setCode(e.target.value),
							placeholder: hint
						})
					}) : null,
					error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-danger",
						children: error
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: hint ? "Open account" : "Send code"
					})
				]
			})
		]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto max-w-2xl px-4 py-10",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-start justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs tracking-wide text-accent uppercase",
						children: home.isp.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "text-2xl font-semibold tracking-tight",
						children: home.customer.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm text-muted",
						children: [
							home.customer.phone,
							" · ",
							home.points,
							" loyalty points"
						]
					})
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "ghost",
					onClick: () => {
						setToken(null);
						setHome(null);
						setHint(null);
					},
					children: "Sign out"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8 space-y-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-medium",
					children: "Services"
				}), home.services.map((s, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: s.package_name }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-xs text-muted",
						children: [
							s.access_method,
							" · ",
							s.username
						]
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
						tone: statusTone(s.status),
						children: s.status
					})]
				}, i))]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8 space-y-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-medium",
					children: "Invoices"
				}), home.invoices.map((inv) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-mono text-sm",
						children: inv.number
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-xs text-muted",
						children: ["Due ", inv.due_date]
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono text-sm",
							children: kes(inv.remaining_kes ?? inv.amount_kes)
						}), inv.status === "paid" || (inv.remaining_kes ?? 0) <= 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							tone: "ok",
							children: "paid"
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "sm",
							onClick: async () => {
								if (!token) return;
								await portalPay({ data: {
									token,
									invoice_id: inv.id
								} });
								await refresh(token);
							},
							children: "Pay M-Pesa"
						})]
					})]
				}, inv.id))]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8 space-y-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-medium",
					children: "Messages"
				}), home.inbox?.length ? home.inbox.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-xl border border-border bg-surface px-4 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-medium",
						children: m.subject
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: m.body
					})]
				}, m.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "No messages yet."
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "mt-8 grid gap-3 rounded-xl border border-border bg-surface p-4",
				onSubmit: async (e) => {
					e.preventDefault();
					if (!token) return;
					await portalOpenTicket({ data: {
						token,
						title: ticket
					} });
					setTicket("");
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-medium",
						children: "Need help?"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Describe the issue",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: ticket,
							onChange: (e) => setTicket(e.target.value),
							placeholder: "No internet since evening…"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: "Open ticket"
					})
				]
			})
		]
	});
}
//#endregion
export { PortalHome as component };
