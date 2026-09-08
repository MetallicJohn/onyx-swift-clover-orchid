import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { l as importCustomers, s as exportCustomersCsv } from "./server-D7YxL8yv.mjs";
import { t as Button } from "./button-C2DQffKf.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/import-D-MUEAZK.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function ImportPage() {
	const [result, setResult] = (0, import_react.useState)(null);
	const [busy, setBusy] = (0, import_react.useState)(false);
	function parseCsv(text) {
		const lines = text.trim().split(/\r?\n/);
		if (lines.length < 2) return [];
		const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
		return lines.slice(1).map((line) => {
			const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
			const get = (k) => cols[headers.indexOf(k)] ?? "";
			return {
				name: get("name"),
				phone: get("phone"),
				email: get("email"),
				address: get("address"),
				access_method: get("access_method") || "pppoe",
				username: get("username"),
				static_ip: get("static_ip"),
				package_name: get("package_name")
			};
		});
	}
	async function onFile(file) {
		setBusy(true);
		setResult(null);
		try {
			const rows = parseCsv(await file.text());
			const res = await importCustomers({ data: { rows } });
			setResult(res);
		} finally {
			setBusy(false);
		}
	}
	async function onExport() {
		const csv = await exportCustomersCsv();
		const blob = new Blob([csv], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "gridline-customers.csv";
		a.click();
		URL.revokeObjectURL(url);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Import / export"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Fast onboarding for PPPoE and static customers. Preview is not required — invalid rows are skipped with errors."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 md:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-medium",
							children: "Import CSV"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-sm text-muted",
							children: "Columns: name, phone, email, address, access_method (pppoe|static|hotspot), username, static_ip, package_name"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "mt-4 block w-full text-sm",
							type: "file",
							accept: ".csv,text/csv",
							disabled: busy,
							onChange: (e) => {
								const f = e.target.files?.[0];
								if (f) onFile(f);
							}
						}),
						result ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-4 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-ok",
								children: [result.created, " customers created"]
							}), result.errors.map((err) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-danger",
								children: err
							}, err))]
						}) : null
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-medium",
							children: "Export"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-sm text-muted",
							children: "Download customers with PPPoE usernames and static IPs."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							className: "mt-4",
							variant: "secondary",
							onClick: () => void onExport(),
							children: "Download CSV"
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
				className: "overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs text-muted",
				children: `name,phone,email,address,access_method,username,static_ip,package_name
Jane Muthoni,+254700111222,jane@example.com,Karen,pppoe,jane.muthoni,,Home 10
Acme Ltd,+254700333444,net@acme.ke,Industrial Area,static,,102.68.10.20,Business 50`
			})
		]
	});
}
//#endregion
export { ImportPage as component };
