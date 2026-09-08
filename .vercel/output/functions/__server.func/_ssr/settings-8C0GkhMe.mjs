import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as kes } from "./utils-Cu94vfxT.mjs";
import { _ as renameTenant, c as getDashboard, f as listPackages, i as createPackage } from "./server-D7YxL8yv.mjs";
import { t as Button } from "./button-C2DQffKf.mjs";
import { n as Input, t as Field } from "./input-DvnPVGOJ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/settings-8C0GkhMe.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function SettingsPage() {
	const [ws, setWs] = (0, import_react.useState)(null);
	const [packages, setPackages] = (0, import_react.useState)([]);
	const [form, setForm] = (0, import_react.useState)({
		name: "",
		supportEmail: "",
		supportPhone: ""
	});
	const [pkg, setPkg] = (0, import_react.useState)({
		name: "",
		description: "",
		access_method: "pppoe",
		download_mbps: 10,
		upload_mbps: 5,
		price_kes: 2500,
		billing_interval: "monthly",
		grace_days: 5
	});
	async function load() {
		const [d, p] = await Promise.all([getDashboard(), listPackages()]);
		setWs(d.workspace);
		setForm({
			name: d.workspace.tenantName,
			supportEmail: d.workspace.supportEmail,
			supportPhone: d.workspace.supportPhone
		});
		setPackages(p.packages);
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-8",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Settings"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Tenant branding and product catalog. Nothing is hard-coded to a single ISP."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4",
				onSubmit: async (e) => {
					e.preventDefault();
					await renameTenant({ data: form });
					await load();
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-medium",
						children: "ISP profile"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "ISP name",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.name,
							onChange: (e) => setForm({
								...form,
								name: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Support email",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.supportEmail,
							onChange: (e) => setForm({
								...form,
								supportEmail: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Support phone",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.supportPhone,
							onChange: (e) => setForm({
								...form,
								supportPhone: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs text-subtle",
						children: [
							"Role: ",
							ws?.role,
							" · Plan: ",
							ws?.status
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: "Save"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "mb-3 font-medium",
				children: "Packages"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid gap-3 md:grid-cols-2",
				children: packages.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-medium",
							children: p.name
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs text-muted uppercase",
							children: p.access_method
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-mono text-sm",
							children: kes(p.price_kes)
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2 text-sm text-muted",
						children: [
							p.download_mbps,
							"/",
							p.upload_mbps,
							" Mbps · ",
							p.billing_interval,
							" · ",
							p.grace_days,
							"d grace"
						]
					})]
				}, p.id))
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4",
				onSubmit: async (e) => {
					e.preventDefault();
					await createPackage({ data: pkg });
					setPkg({
						...pkg,
						name: ""
					});
					await load();
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-medium",
						children: "New package"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Name",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							required: true,
							value: pkg.name,
							onChange: (e) => setPkg({
								...pkg,
								name: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Description",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: pkg.description,
							onChange: (e) => setPkg({
								...pkg,
								description: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid grid-cols-2 gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Download Mbps",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								type: "number",
								value: pkg.download_mbps,
								onChange: (e) => setPkg({
									...pkg,
									download_mbps: Number(e.target.value)
								})
							})
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Upload Mbps",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								type: "number",
								value: pkg.upload_mbps,
								onChange: (e) => setPkg({
									...pkg,
									upload_mbps: Number(e.target.value)
								})
							})
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Price KES",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							value: pkg.price_kes,
							onChange: (e) => setPkg({
								...pkg,
								price_kes: Number(e.target.value)
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: "Add package"
					})
				]
			})
		]
	});
}
//#endregion
export { SettingsPage as component };
