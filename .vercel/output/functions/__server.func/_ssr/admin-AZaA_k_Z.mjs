import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as createIspAsAdmin, h as platformStatus, p as listPlatformTenants } from "./server-more-C5Y0MTly.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, t as Field } from "./input-BJCOk2ZM.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin-AZaA_k_Z.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function AdminPage() {
	const [allowed, setAllowed] = (0, import_react.useState)(null);
	const [tenants, setTenants] = (0, import_react.useState)([]);
	const [form, setForm] = (0, import_react.useState)({
		isp_name: "",
		owner_name: "",
		owner_email: "",
		owner_password: ""
	});
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)(null);
	const [ok, setOk] = (0, import_react.useState)(null);
	async function load() {
		const p = await platformStatus();
		setAllowed(p.admin);
		if (!p.admin) return;
		const rows = await listPlatformTenants();
		setTenants(rows.tenants);
	}
	(0, import_react.useEffect)(() => {
		load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
	}, []);
	if (allowed === false) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "text-sm text-danger",
		children: "Only a Gridline superadmin can open this desk."
	});
	if (allowed === null) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "h-32 animate-pulse rounded-xl bg-surface" });
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Superadmin"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Create ISP workspaces and owner logins. Owners sign in with the email and password you set here."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2",
				onSubmit: async (e) => {
					e.preventDefault();
					setBusy(true);
					setError(null);
					setOk(null);
					try {
						const created = await createIspAsAdmin({ data: form });
						setOk(`Created ${created.tenant_name}. ${created.owner_email} can sign in now.`);
						setForm({
							isp_name: "",
							owner_name: "",
							owner_email: "",
							owner_password: ""
						});
						await load();
					} catch (err) {
						setError(err instanceof Error ? err.message : "Could not create ISP");
					} finally {
						setBusy(false);
					}
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "ISP name",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							required: true,
							value: form.isp_name,
							onChange: (e) => setForm({
								...form,
								isp_name: e.target.value
							}),
							placeholder: "Imani Networks Limited"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Owner name",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							required: true,
							value: form.owner_name,
							onChange: (e) => setForm({
								...form,
								owner_name: e.target.value
							}),
							placeholder: "Jane Wanjiku"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Owner email",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "email",
							required: true,
							value: form.owner_email,
							onChange: (e) => setForm({
								...form,
								owner_email: e.target.value
							}),
							placeholder: "jane@imani.ke"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Owner password",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "password",
							required: true,
							minLength: 8,
							value: form.owner_password,
							onChange: (e) => setForm({
								...form,
								owner_password: e.target.value
							}),
							autoComplete: "new-password",
							placeholder: "At least 8 characters"
						})
					}),
					error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-danger sm:col-span-2",
						children: error
					}) : null,
					ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-ok sm:col-span-2",
						children: ok
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "sm:col-span-2",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "submit",
							disabled: busy,
							children: busy ? "Creating…" : "Create ISP + owner login"
						})
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "divide-y divide-border overflow-hidden rounded-xl border border-border",
				children: [tenants.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex items-center justify-between bg-surface px-4 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-medium",
						children: t.name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-xs text-muted",
						children: [
							t.slug,
							" · ",
							t.members,
							" staff"
						]
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-sm text-muted",
						children: t.status
					})]
				}, t.id)), tenants.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "px-4 py-6 text-sm text-muted",
					children: "No ISPs yet."
				}) : null]
			})
		]
	});
}
//#endregion
export { AdminPage as component };
