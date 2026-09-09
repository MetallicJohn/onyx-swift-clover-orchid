import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { y as kes } from "./rls-stkZtAMF.mjs";
import { t as Button } from "./button-CL6xUAzZ.mjs";
import { r as Select, t as Field } from "./input-D9suXaeu.mjs";
import { s as getStatement } from "./server-more-DGqdDn90.mjs";
import { f as listCustomers } from "./server-Dc13Q75o.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/statements-CnNlKoAC.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function StatementsPage() {
	const [customers, setCustomers] = (0, import_react.useState)([]);
	const [id, setId] = (0, import_react.useState)("");
	const [doc, setDoc] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		listCustomers().then((r) => {
			setCustomers(r.customers);
			const first = new URLSearchParams(window.location.search).get("customer") || r.customers[0]?.id || "";
			setId(first);
			if (first) getStatement({ data: { customer_id: first } }).then(setDoc).catch(console.error);
		}).catch(console.error);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex flex-wrap items-end justify-between gap-3 print:hidden",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Statement"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Ledger, invoices, and receipts for one account."
			})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
					label: "Customer",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, {
						value: id,
						onChange: async (e) => {
							setId(e.target.value);
							setDoc(await getStatement({ data: { customer_id: e.target.value } }));
						},
						children: customers.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: c.id,
							children: c.name
						}, c.id))
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					className: "self-end",
					variant: "secondary",
					onClick: () => window.print(),
					children: "Print"
				})]
			})]
		}), doc ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "space-y-6 rounded-xl border border-border bg-surface p-6",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "text-xl font-semibold",
						children: doc.customer.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm text-muted",
						children: [
							doc.customer.phone,
							" · ",
							doc.customer.email,
							" · ",
							doc.customer.address
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2 font-mono text-sm",
						children: ["Balance ", kes(doc.balance)]
					})
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "mb-2 font-medium",
					children: "Invoices"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "text-sm",
					children: doc.invoices.map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex justify-between py-1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
							i.number,
							" · ",
							i.status,
							" · due ",
							i.due_date.slice(0, 10)
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono",
							children: kes(i.amount_kes)
						})]
					}, i.number))
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "mb-2 font-medium",
					children: "Payments"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "text-sm",
					children: doc.payments.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex justify-between py-1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
							p.provider,
							" ",
							p.reference,
							" · ",
							p.status
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono",
							children: kes(p.amount_kes)
						})]
					}, p.reference))
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "mb-2 font-medium",
					children: "Ledger"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "text-sm",
					children: doc.ledger.map((l, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex justify-between py-1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
							l.entry_type,
							" ",
							l.memo
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono",
							children: l.debit_kes ? `Dr ${kes(l.debit_kes)}` : `Cr ${kes(l.credit_kes)}`
						})]
					}, i))
				})] })
			]
		}) : null]
	});
}
//#endregion
export { StatementsPage as component };
