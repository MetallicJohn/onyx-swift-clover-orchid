import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as statusTone, t as Badge } from "./badge-BO-VQeJb.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, r as Select, t as Field } from "./input-BJCOk2ZM.mjs";
import { T as revokeHotspotVoucher, _ as listHotspot, s as createVouchers, t as activateHotspotVoucher } from "./server-ops-Cjhg1W_o.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/hotspot-daouizf_.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function toneFor(status) {
	if (status === "unused") return statusTone("pending");
	if (status === "active") return statusTone("active");
	if (status === "expired") return statusTone("grace");
	return statusTone("suspended");
}
function HotspotPage() {
	const [vouchers, setVouchers] = (0, import_react.useState)([]);
	const [packages, setPackages] = (0, import_react.useState)([]);
	const [sessions, setSessions] = (0, import_react.useState)([]);
	const [form, setForm] = (0, import_react.useState)({
		package_id: "",
		count: 5,
		hours: 24
	});
	const [codes, setCodes] = (0, import_react.useState)([]);
	const [note, setNote] = (0, import_react.useState)(null);
	async function load() {
		const r = await listHotspot();
		setVouchers(r.vouchers);
		setPackages(r.packages);
		setSessions(r.sessions);
		if (!form.package_id && r.packages[0]) setForm((f) => ({
			...f,
			package_id: r.packages[0].id
		}));
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Hotspot"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Unused codes wait at the till. Activate creates RADIUS + a hotspot service; expiry disables both."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-4",
				onSubmit: async (e) => {
					e.preventDefault();
					const r = await createVouchers({ data: form });
					setCodes(r.codes);
					await load();
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Package",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, {
							value: form.package_id,
							onChange: (e) => setForm({
								...form,
								package_id: e.target.value
							}),
							children: packages.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: p.id,
								children: p.name
							}, p.id))
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Count",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							min: 1,
							max: 50,
							value: form.count,
							onChange: (e) => setForm({
								...form,
								count: Number(e.target.value)
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Hours after activate",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							min: 1,
							value: form.hours,
							onChange: (e) => setForm({
								...form,
								hours: Number(e.target.value)
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "flex items-end",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "submit",
							children: "Generate"
						})
					})
				]
			}),
			codes.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "rounded-xl border border-border bg-elevated p-3 font-mono text-xs",
				children: codes.join("  ")
			}) : null,
			note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-accent",
				children: note
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
				children: vouchers.map((v) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-start justify-between",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-mono text-sm",
								children: v.code
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
								tone: toneFor(v.status),
								children: v.status
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-2 text-sm text-muted",
							children: [
								v.package_name,
								" · ",
								v.hours,
								"h",
								v.expires_at ? ` · until ${v.expires_at.slice(0, 16).replace("T", " ")}` : ""
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-3 flex flex-wrap gap-1",
							children: [v.status === "unused" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								size: "sm",
								variant: "secondary",
								onClick: async () => {
									const r = await activateHotspotVoucher({ data: { id: v.id } });
									setNote(`Activated ${r.code} until ${r.expires_at.slice(0, 16).replace("T", " ")}`);
									await load();
								},
								children: "Activate"
							}) : null, v.status === "unused" || v.status === "active" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								size: "sm",
								variant: "ghost",
								onClick: async () => {
									await revokeHotspotVoucher({ data: { id: v.id } });
									await load();
								},
								children: "Revoke"
							}) : null]
						})
					]
				}, v.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "mb-3 font-medium",
				children: "Hotspot sessions"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "overflow-x-auto rounded-xl border border-border",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
					className: "w-full min-w-[28rem] text-left text-sm",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
						className: "bg-surface text-xs text-muted",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "User"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "IP"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "NAS"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "Stopped"
							})
						] })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", {
						className: "divide-y divide-border",
						children: sessions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "px-4 py-6 text-muted",
							colSpan: 4,
							children: "Sessions appear when RADIUS accounting is received."
						}) }) : sessions.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3 font-mono text-xs",
								children: s.username
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3 font-mono text-xs",
								children: s.framed_ip
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3 font-mono text-xs",
								children: s.nas_ip
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3 text-xs",
								children: s.stopped_at ? "yes" : "online"
							})
						] }, s.id))
					})]
				})
			})] })
		]
	});
}
//#endregion
export { HotspotPage as component };
