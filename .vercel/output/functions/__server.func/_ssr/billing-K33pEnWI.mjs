import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as kes } from "./utils-Cu94vfxT.mjs";
import { g as recordPayment, r as createInvoice, u as listBilling } from "./server-D7YxL8yv.mjs";
import { n as statusTone, t as Badge } from "./badge-z-BRSIMA.mjs";
import { t as Button } from "./button-C2DQffKf.mjs";
import { n as Input, r as Select, t as Field } from "./input-DvnPVGOJ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/billing-K33pEnWI.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function BillingPage() {
	const [invoices, setInvoices] = (0, import_react.useState)([]);
	const [payments, setPayments] = (0, import_react.useState)([]);
	const [customers, setCustomers] = (0, import_react.useState)([]);
	const [tab, setTab] = (0, import_react.useState)("invoices");
	const [form, setForm] = (0, import_react.useState)({
		customer_id: "",
		amount_kes: 2500,
		due_date: ""
	});
	const [pay, setPay] = (0, import_react.useState)({
		invoice_id: "",
		provider: "mpesa",
		reference: ""
	});
	const [err, setErr] = (0, import_react.useState)(null);
	async function load() {
		const res = await listBilling();
		setInvoices(res.invoices);
		setPayments(res.payments);
		setCustomers(res.customers);
		if (!form.customer_id && res.customers[0]) setForm((f) => ({
			...f,
			customer_id: res.customers[0].id
		}));
		const unpaid = res.invoices.find((i) => i.status !== "paid");
		if (unpaid) setPay((p) => ({
			...p,
			invoice_id: unpaid.id
		}));
	}
	(0, import_react.useEffect)(() => {
		const d = /* @__PURE__ */ new Date();
		d.setDate(d.getDate() + 14);
		setForm((f) => ({
			...f,
			due_date: d.toISOString().slice(0, 10)
		}));
		load().catch(console.error);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Billing"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Immutable invoices. Payments are idempotent by provider reference. A confirmed payment restores service."
			})] }),
			err ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-danger",
				children: err
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 lg:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "grid gap-3 rounded-xl border border-border bg-surface p-4",
					onSubmit: async (e) => {
						e.preventDefault();
						setErr(null);
						try {
							await createInvoice({ data: form });
							await load();
						} catch (ex) {
							setErr(ex instanceof Error ? ex.message : "Invoice failed");
						}
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-medium",
							children: "Issue invoice"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Customer",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, {
								value: form.customer_id,
								onChange: (e) => setForm({
									...form,
									customer_id: e.target.value
								}),
								children: customers.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: c.id,
									children: c.name
								}, c.id))
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Amount (KES)",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								type: "number",
								min: 1,
								value: form.amount_kes,
								onChange: (e) => setForm({
									...form,
									amount_kes: Number(e.target.value)
								})
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Due date",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								type: "date",
								value: form.due_date,
								onChange: (e) => setForm({
									...form,
									due_date: e.target.value
								})
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "submit",
							children: "Issue"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "grid gap-3 rounded-xl border border-border bg-surface p-4",
					onSubmit: async (e) => {
						e.preventDefault();
						setErr(null);
						try {
							await recordPayment({ data: pay });
							setPay((p) => ({
								...p,
								reference: ""
							}));
							await load();
						} catch (ex) {
							setErr(ex instanceof Error ? ex.message : "Payment failed");
						}
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-medium",
							children: "Record payment"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Invoice",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, {
								value: pay.invoice_id,
								onChange: (e) => setPay({
									...pay,
									invoice_id: e.target.value
								}),
								children: invoices.map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
									value: i.id,
									children: [
										i.number,
										" · ",
										i.customer_name,
										" · ",
										i.status
									]
								}, i.id))
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Provider",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
								value: pay.provider,
								onChange: (e) => setPay({
									...pay,
									provider: e.target.value
								}),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "mpesa",
										children: "M-Pesa"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "airtel",
										children: "Airtel Money"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "bank",
										children: "Bank"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "cash",
										children: "Cash"
									})
								]
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Reference",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								required: true,
								placeholder: "M-Pesa receipt",
								value: pay.reference,
								onChange: (e) => setPay({
									...pay,
									reference: e.target.value
								})
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "submit",
							children: "Confirm payment"
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: tab === "invoices" ? "default" : "secondary",
					size: "sm",
					onClick: () => setTab("invoices"),
					children: "Invoices"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: tab === "payments" ? "default" : "secondary",
					size: "sm",
					onClick: () => setTab("payments"),
					children: "Payments"
				})]
			}),
			tab === "invoices" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Table, {
				headers: [
					"Number",
					"Customer",
					"Amount",
					"Due",
					"Status"
				],
				rows: invoices.map((i) => [
					i.number,
					i.customer_name,
					kes(i.amount_kes),
					i.due_date,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
						tone: statusTone(i.status),
						children: i.status
					}, i.id)
				])
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Table, {
				headers: [
					"Reference",
					"Customer",
					"Provider",
					"Amount",
					"Status"
				],
				rows: payments.map((p) => [
					p.reference,
					p.customer_name,
					p.provider,
					kes(p.amount_kes),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
						tone: statusTone(p.status),
						children: p.status
					}, p.id)
				])
			})
		]
	});
}
function Table({ headers, rows }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "overflow-x-auto rounded-xl border border-border",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
			className: "w-full min-w-[36rem] text-left text-sm",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
				className: "bg-surface text-xs text-muted",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: headers.map((h) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
					className: "px-4 py-3 font-medium",
					children: h
				}, h)) })
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", {
				className: "divide-y divide-border",
				children: rows.map((r, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: r.map((c, j) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
					className: "px-4 py-3",
					children: c
				}, j)) }, i))
			})]
		})
	});
}
//#endregion
export { BillingPage as component };
