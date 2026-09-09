import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { j as kes } from "./access-1saCIo2_.mjs";
import { n as statusTone, t as Badge } from "./badge-BO-VQeJb.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, r as Select, t as Field } from "./input-BJCOk2ZM.mjs";
import { A as updatePackage, _ as listPackages, a as createPackage } from "./server-C1t-C6za.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/packages-DWQi_2Vf.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var EMPTY = {
	name: "",
	description: "",
	access_method: "pppoe",
	download_mbps: 10,
	upload_mbps: 5,
	price_kes: 2500,
	billing_interval: "monthly",
	grace_days: 5,
	bundle_mb: 0,
	validity_hours: 0,
	active: true
};
function PackagesPage() {
	const [packages, setPackages] = (0, import_react.useState)([]);
	const [filter, setFilter] = (0, import_react.useState)("all");
	const [editingId, setEditingId] = (0, import_react.useState)(null);
	const [form, setForm] = (0, import_react.useState)(EMPTY);
	const [open, setOpen] = (0, import_react.useState)(false);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)(null);
	async function load() {
		const res = await listPackages();
		setPackages(res.packages);
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	function startCreate() {
		setEditingId(null);
		setForm(EMPTY);
		setOpen(true);
		setError(null);
	}
	function startEdit(p) {
		setEditingId(p.id);
		setForm({
			name: p.name,
			description: p.description,
			access_method: p.access_method,
			download_mbps: p.download_mbps,
			upload_mbps: p.upload_mbps,
			price_kes: p.price_kes,
			billing_interval: p.billing_interval,
			grace_days: p.grace_days,
			bundle_mb: p.bundle_mb,
			validity_hours: p.validity_hours,
			active: p.active
		});
		setOpen(true);
		setError(null);
	}
	async function submit(e) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			if (editingId) await updatePackage({ data: {
				id: editingId,
				...form
			} });
			else await createPackage({ data: form });
			setOpen(false);
			setEditingId(null);
			setForm(EMPTY);
			await load();
		} catch (ex) {
			setError(ex instanceof Error ? ex.message : "Save failed");
		} finally {
			setBusy(false);
		}
	}
	async function toggleActive(p) {
		await updatePackage({ data: {
			id: p.id,
			name: p.name,
			description: p.description,
			access_method: p.access_method,
			download_mbps: p.download_mbps,
			upload_mbps: p.upload_mbps,
			price_kes: p.price_kes,
			billing_interval: p.billing_interval,
			grace_days: p.grace_days,
			bundle_mb: p.bundle_mb,
			validity_hours: p.validity_hours,
			active: !p.active
		} });
		await load();
	}
	const visible = packages.filter((p) => filter === "all" || p.access_method === filter);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-2xl font-semibold tracking-tight",
					children: "Packages"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "Product catalog for PPPoE, static IP, and hotspot. Unpaid invoices, expired time, or a used-up data cap suspend access automatically. Payment restores it."
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					onClick: startCreate,
					children: "New package"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-wrap gap-2",
				children: [
					"all",
					"pppoe",
					"static",
					"hotspot"
				].map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					size: "sm",
					variant: filter === m ? "default" : "secondary",
					onClick: () => setFilter(m),
					children: m === "all" ? "All" : m === "pppoe" ? "PPPoE" : m === "static" ? "Static IP" : "Hotspot"
				}, m))
			}),
			open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				onSubmit: submit,
				className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-medium md:col-span-2",
						children: editingId ? "Edit package" : "Create package"
					}),
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
						label: "Access method",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: form.access_method,
							onChange: (e) => setForm({
								...form,
								access_method: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "pppoe",
									children: "PPPoE"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "static",
									children: "Static IP"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "hotspot",
									children: "Hotspot"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Description",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.description,
							onChange: (e) => setForm({
								...form,
								description: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Billing interval",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: form.billing_interval,
							onChange: (e) => setForm({
								...form,
								billing_interval: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "daily",
									children: "Daily"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "weekly",
									children: "Weekly"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "monthly",
									children: "Monthly"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Download Mbps",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							min: 1,
							value: form.download_mbps,
							onChange: (e) => setForm({
								...form,
								download_mbps: Number(e.target.value)
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Upload Mbps",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							min: 1,
							value: form.upload_mbps,
							onChange: (e) => setForm({
								...form,
								upload_mbps: Number(e.target.value)
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Price (KES)",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							min: 0,
							value: form.price_kes,
							onChange: (e) => setForm({
								...form,
								price_kes: Number(e.target.value)
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Grace days",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							min: 0,
							value: form.grace_days,
							onChange: (e) => setForm({
								...form,
								grace_days: Number(e.target.value)
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Data cap GB (0 = unlimited)",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							min: 0,
							value: form.bundle_mb ? Math.round(form.bundle_mb / 1024) : 0,
							onChange: (e) => setForm({
								...form,
								bundle_mb: Math.max(0, Number(e.target.value)) * 1024
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Validity hours (0 = billing interval)",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "number",
							min: 0,
							value: form.validity_hours,
							onChange: (e) => setForm({
								...form,
								validity_hours: Number(e.target.value)
							})
						})
					}),
					editingId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Availability",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: form.active ? "active" : "inactive",
							onChange: (e) => setForm({
								...form,
								active: e.target.value === "active"
							}),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "active",
								children: "Active — can be assigned"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "inactive",
								children: "Inactive — hidden from new services"
							})]
						})
					}) : null,
					error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-danger md:col-span-2",
						children: error
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex gap-2 md:col-span-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "submit",
							disabled: busy,
							children: busy ? "Saving…" : editingId ? "Save changes" : "Create package"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "button",
							variant: "ghost",
							onClick: () => {
								setOpen(false);
								setEditingId(null);
							},
							children: "Cancel"
						})]
					})
				]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid gap-3 md:grid-cols-2",
				children: visible.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-start justify-between gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-medium",
								children: p.name
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mt-1 flex flex-wrap items-center gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
									tone: "accent",
									children: p.access_method === "pppoe" ? "PPPoE" : p.access_method === "static" ? "Static IP" : "Hotspot"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
									tone: statusTone(p.active ? "active" : "pending"),
									children: p.active ? "active" : "inactive"
								})]
							})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-mono text-sm tabular-nums",
								children: kes(p.price_kes)
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-3 text-sm text-muted",
							children: [
								p.download_mbps,
								"/",
								p.upload_mbps,
								" Mbps · ",
								p.billing_interval,
								p.validity_hours ? ` · ${p.validity_hours}h` : "",
								" · ",
								p.grace_days,
								"d grace",
								p.bundle_mb ? ` · ${p.bundle_mb >= 1024 ? `${Math.round(p.bundle_mb / 1024)} GB` : `${p.bundle_mb} MB`}` : " · unlimited"
							]
						}),
						p.description ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-sm text-subtle",
							children: p.description
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-4 flex flex-wrap gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								size: "sm",
								variant: "secondary",
								onClick: () => startEdit(p),
								children: "Edit"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								size: "sm",
								variant: "ghost",
								onClick: () => void toggleActive(p),
								children: p.active ? "Deactivate" : "Activate"
							})]
						})
					]
				}, p.id))
			}),
			visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "No packages in this mode yet."
			}) : null
		]
	});
}
//#endregion
export { PackagesPage as component };
