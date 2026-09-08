import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { p as listRouters, t as addRouter } from "./server-D7YxL8yv.mjs";
import { n as statusTone, t as Badge } from "./badge-z-BRSIMA.mjs";
import { t as Button } from "./button-C2DQffKf.mjs";
import { n as Input, r as Select, t as Field } from "./input-DvnPVGOJ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routers-rYlxFxGh.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function RoutersPage() {
	const [rows, setRows] = (0, import_react.useState)([]);
	const [form, setForm] = (0, import_react.useState)({
		name: "",
		location: "",
		identity: "",
		role: "access"
	});
	const [script, setScript] = (0, import_react.useState)(null);
	async function load() {
		const res = await listRouters();
		setRows(res.routers);
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	async function submit(e) {
		e.preventDefault();
		await addRouter({ data: form });
		setScript(generateScript(form.name, form.identity || form.name.toLowerCase()));
		setForm({
			name: "",
			location: "",
			identity: "",
			role: "access"
		});
		await load();
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Routers"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Agent + WireGuard model. Routers never expose API ports to the public internet. Paste the generated RouterOS snippet on the device after approval."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				onSubmit: submit,
				className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Name",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							required: true,
							value: form.name,
							onChange: (e) => setForm({
								...form,
								name: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Location",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.location,
							onChange: (e) => setForm({
								...form,
								location: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Identity",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.identity,
							onChange: (e) => setForm({
								...form,
								identity: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Role",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: form.role,
							onChange: (e) => setForm({
								...form,
								role: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "core",
									children: "Core"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "edge",
									children: "Edge"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "access",
									children: "Access"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "hotspot",
									children: "Hotspot"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: "Add router"
					})
				]
			}),
			script ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
				className: "overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg",
				children: script
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "overflow-x-auto rounded-xl border border-border",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
					className: "w-full min-w-[36rem] text-left text-sm",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
						className: "bg-surface text-xs text-muted",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "Router"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "Role"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "WireGuard"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "CPU"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "Uptime"
							})
						] })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", {
						className: "divide-y divide-border",
						children: rows.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "px-4 py-3",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: r.name }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-xs text-muted",
									children: r.location
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3 capitalize",
								children: r.role
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
									tone: statusTone(r.wg_status),
									children: r.wg_status
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "px-4 py-3 font-mono",
								children: [r.cpu_pct, "%"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "px-4 py-3 font-mono",
								children: [r.uptime_hours, "h"]
							})
						] }, r.id))
					})]
				})
			})
		]
	});
}
function generateScript(name, identity) {
	return `/system identity set name="${identity || name}"
# Gridline agent onboarding — review before apply
/interface wireguard add name=wg-gridline listen-port=13231
/ip address add address=10.200.0.2/24 interface=wg-gridline
/ip firewall filter add chain=input protocol=udp dst-port=13231 action=accept comment="gridline-wg"
# RADIUS and API stay on the tunnel only — never bind management to WAN
/ip service set api address=10.200.0.0/24
/ip service set winbox address=10.200.0.0/24`;
}
//#endregion
export { RoutersPage as component };
