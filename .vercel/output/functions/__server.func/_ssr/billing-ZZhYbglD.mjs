import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { j as kes } from "./access-1saCIo2_.mjs";
import { m as Printer } from "../_libs/lucide-react.mjs";
import { n as statusTone, t as Badge } from "./badge-BO-VQeJb.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, r as Select, t as Field } from "./input-BJCOk2ZM.mjs";
import { D as sendStk, o as confirmStk } from "./server-ops-Cjhg1W_o.mjs";
import { T as saveBillingSettings, d as getInvoice, i as createInvoice, p as listBilling, x as recordPayment } from "./server-C1t-C6za.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/billing-ZZhYbglD.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function defaultDue() {
	const d = /* @__PURE__ */ new Date();
	d.setDate(d.getDate() + 14);
	return d.toISOString().slice(0, 10);
}
function BillingPage() {
	const [invoices, setInvoices] = (0, import_react.useState)([]);
	const [payments, setPayments] = (0, import_react.useState)([]);
	const [customers, setCustomers] = (0, import_react.useState)([]);
	const [quotes, setQuotes] = (0, import_react.useState)([]);
	const [vatEnabled, setVatEnabled] = (0, import_react.useState)(false);
	const [vatRate, setVatRate] = (0, import_react.useState)(16);
	const [totals, setTotals] = (0, import_react.useState)({
		outstanding: 0,
		overdue: 0,
		collected: 0,
		open: 0
	});
	const [aging, setAging] = (0, import_react.useState)({});
	const [tab, setTab] = (0, import_react.useState)("invoices");
	const [filter, setFilter] = (0, import_react.useState)("open");
	const [form, setForm] = (0, import_react.useState)({
		customer_id: "",
		due_date: "",
		notes: ""
	});
	const [lines, setLines] = (0, import_react.useState)([]);
	const [pay, setPay] = (0, import_react.useState)({
		invoice_id: "",
		provider: "mpesa",
		reference: "",
		amount_kes: 0
	});
	const [err, setErr] = (0, import_react.useState)(null);
	const [stk, setStk] = (0, import_react.useState)(null);
	const [detail, setDetail] = (0, import_react.useState)(null);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const preview = (0, import_react.useMemo)(() => {
		const subtotal = lines.reduce((sum, line) => sum + Math.max(1, line.quantity || 1) * Math.max(0, line.unit_kes || 0), 0);
		const tax = vatEnabled ? Math.round(subtotal * vatRate / 100) : 0;
		return {
			subtotal,
			tax,
			total: subtotal + tax,
			tax_rate: vatEnabled ? vatRate : 0
		};
	}, [
		lines,
		vatEnabled,
		vatRate
	]);
	function quotesFor(customerId) {
		const q = quotes.filter((x) => x.customer_id === customerId);
		if (q.length === 0) return [{
			description: "Internet service",
			quantity: 1,
			unit_kes: 2500
		}];
		return q.map((x) => ({
			description: `${x.package_name} (${x.billing_interval})`,
			quantity: 1,
			unit_kes: x.price_kes,
			package_id: x.package_id,
			service_id: x.service_id
		}));
	}
	async function load(selectId) {
		const res = await listBilling();
		setInvoices(res.invoices);
		setPayments(res.payments);
		setCustomers(res.customers);
		setQuotes(res.quotes);
		setVatEnabled(res.vat_enabled);
		setVatRate(res.vat_rate_pct);
		setTotals(res.totals);
		setAging(res.aging);
		if (!form.customer_id && res.customers[0]) {
			setForm((f) => ({
				...f,
				customer_id: res.customers[0].id
			}));
			setLines(quotesForCustomer(res.quotes, res.customers[0].id));
		}
		const target = selectId || pay.invoice_id;
		const unpaid = res.invoices.find((i) => i.id === target) || res.invoices.find((i) => i.remaining_kes > 0);
		if (unpaid) setPay((p) => ({
			...p,
			invoice_id: unpaid.id,
			amount_kes: unpaid.remaining_kes || unpaid.amount_kes
		}));
		return res;
	}
	(0, import_react.useEffect)(() => {
		setForm((f) => ({
			...f,
			due_date: defaultDue()
		}));
		load().catch(console.error);
	}, []);
	const visible = invoices.filter((i) => {
		if (filter === "all") return true;
		if (filter === "open") return i.remaining_kes > 0;
		return i.status === filter;
	});
	async function openInvoice(id) {
		setErr(null);
		const doc = await getInvoice({ data: { id } });
		setDetail(doc);
		setPay((p) => ({
			...p,
			invoice_id: doc.invoice.id,
			amount_kes: doc.invoice.remaining_kes || doc.invoice.amount_kes
		}));
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-end justify-between gap-3 print:hidden",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-2xl font-semibold tracking-tight",
					children: "Billing"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "Package-backed invoices, optional VAT, and partial payments. Confirmed payment restores service unless another invoice is still overdue."
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: vatEnabled,
							onChange: async (e) => {
								const on = e.target.checked;
								setVatEnabled(on);
								await saveBillingSettings({ data: {
									vat_enabled: on,
									vat_rate_pct: vatRate
								} });
							}
						}),
						"Add ",
						vatRate,
						"% VAT (exclusive)"
					]
				})]
			}),
			err ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-danger print:hidden",
				children: err
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:hidden",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Outstanding",
						value: kes(totals.outstanding),
						sub: `${totals.open} open invoices`
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Overdue",
						value: kes(totals.overdue),
						sub: "Past due remaining",
						tone: "danger"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Collected",
						value: kes(totals.collected),
						sub: "Confirmed receipts"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Aging 60+",
						value: kes(aging["60+"]?.amount ?? 0),
						sub: `${aging["60+"]?.count ?? 0} invoices`
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid gap-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted sm:grid-cols-5 print:hidden",
				children: [
					"current",
					"1-30",
					"31-60",
					"60+",
					"paid"
				].map((k) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center justify-between gap-2 px-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "uppercase tracking-wide",
						children: k
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "font-mono text-fg",
						children: [
							aging[k]?.count ?? 0,
							" · ",
							kes(aging[k]?.amount ?? 0)
						]
					})]
				}, k))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 lg:grid-cols-2 print:hidden",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "grid gap-3 rounded-xl border border-border bg-surface p-4",
					onSubmit: async (e) => {
						e.preventDefault();
						setErr(null);
						setBusy(true);
						try {
							const inv = await createInvoice({ data: {
								customer_id: form.customer_id,
								due_date: form.due_date,
								notes: form.notes,
								items: lines
							} });
							await load(inv.id);
							await openInvoice(inv.id);
						} catch (ex) {
							setErr(ex instanceof Error ? ex.message : "Invoice failed");
						} finally {
							setBusy(false);
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
								onChange: (e) => {
									const customer_id = e.target.value;
									setForm({
										...form,
										customer_id
									});
									setLines(quotesFor(customer_id));
								},
								children: customers.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: c.id,
									children: c.name
								}, c.id))
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "space-y-2",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-xs font-medium tracking-wide text-muted",
									children: "Lines"
								}),
								lines.map((line, idx) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "grid grid-cols-[1fr_4.5rem_7rem] gap-2",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
											value: line.description,
											onChange: (e) => setLines(lines.map((l, i) => i === idx ? {
												...l,
												description: e.target.value
											} : l))
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
											type: "number",
											min: 1,
											value: line.quantity,
											onChange: (e) => setLines(lines.map((l, i) => i === idx ? {
												...l,
												quantity: Number(e.target.value) || 1
											} : l))
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
											type: "number",
											min: 0,
											value: line.unit_kes,
											onChange: (e) => setLines(lines.map((l, i) => i === idx ? {
												...l,
												unit_kes: Number(e.target.value) || 0
											} : l))
										})
									]
								}, idx)),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "button",
									size: "sm",
									variant: "secondary",
									onClick: () => setLines([...lines, {
										description: "",
										quantity: 1,
										unit_kes: 0
									}]),
									children: "Add line"
								})
							]
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
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Notes",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								value: form.notes,
								onChange: (e) => setForm({
									...form,
									notes: e.target.value
								}),
								placeholder: "Shown on the invoice"
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-end justify-between gap-3 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "text-muted",
								children: [
									"Subtotal ",
									kes(preview.subtotal),
									preview.tax ? ` · VAT ${preview.tax_rate}% ${kes(preview.tax)}` : " · no VAT",
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "font-mono text-fg",
										children: ["Total ", kes(preview.total)]
									})
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "submit",
								disabled: busy || preview.total <= 0,
								children: "Issue"
							})]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "grid gap-3 rounded-xl border border-border bg-surface p-4",
					onSubmit: async (e) => {
						e.preventDefault();
						setErr(null);
						setBusy(true);
						try {
							await recordPayment({ data: {
								invoice_id: pay.invoice_id,
								provider: pay.provider,
								reference: pay.reference,
								amount_kes: pay.amount_kes
							} });
							setPay((p) => ({
								...p,
								reference: ""
							}));
							setStk(null);
							await load(pay.invoice_id);
							if (detail?.invoice.id === pay.invoice_id) await openInvoice(pay.invoice_id);
						} catch (ex) {
							setErr(ex instanceof Error ? ex.message : "Payment failed");
						} finally {
							setBusy(false);
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
								onChange: (e) => {
									const invoice_id = e.target.value;
									const inv = invoices.find((i) => i.id === invoice_id);
									setPay({
										...pay,
										invoice_id,
										amount_kes: inv?.remaining_kes || inv?.amount_kes || 0
									});
								},
								children: invoices.map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
									value: i.id,
									children: [
										i.number,
										" · ",
										i.customer_name,
										" · ",
										i.status,
										" · ",
										kes(i.remaining_kes),
										" due"
									]
								}, i.id))
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "grid gap-3 sm:grid-cols-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Amount (KES)",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									type: "number",
									min: 1,
									value: pay.amount_kes,
									onChange: (e) => setPay({
										...pay,
										amount_kes: Number(e.target.value)
									})
								})
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
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
											children: "M-Pesa Daraja"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "kopokopo",
											children: "Kopo Kopo"
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
							})]
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
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "submit",
								disabled: busy,
								children: "Confirm payment"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "button",
								variant: "secondary",
								disabled: busy || pay.provider !== "mpesa" && pay.provider !== "kopokopo",
								onClick: async () => {
									setErr(null);
									try {
										const r = await sendStk({ data: {
											invoice_id: pay.invoice_id,
											provider: pay.provider,
											amount_kes: pay.amount_kes
										} });
										setStk({
											checkout_id: r.checkout_id,
											note: r.note
										});
										if (r.note && !r.checkout_id.startsWith("ws_")) setErr(r.note);
									} catch (ex) {
										setErr(ex instanceof Error ? ex.message : "STK failed");
									}
								},
								children: "Send STK push"
							})]
						})
					]
				})]
			}),
			stk ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm print:hidden",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					"STK sent · checkout ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "font-mono",
						children: stk.checkout_id
					}),
					stk.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "text-muted",
						children: [" · ", stk.note]
					}) : null
				] }), stk.checkout_id.startsWith("ws_") ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					size: "sm",
					onClick: async () => {
						await confirmStk({ data: { checkout_id: stk.checkout_id } });
						setStk(null);
						await load(pay.invoice_id);
						if (pay.invoice_id) await openInvoice(pay.invoice_id);
					},
					children: "Simulate Daraja callback"
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-xs text-muted",
					children: "Waiting for the live callback."
				})]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap gap-2 print:hidden",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: tab === "invoices" ? "default" : "secondary",
						size: "sm",
						onClick: () => setTab("invoices"),
						children: "Invoices"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: tab === "payments" ? "default" : "secondary",
						size: "sm",
						onClick: () => setTab("payments"),
						children: "Payments"
					}),
					tab === "invoices" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
						value: filter,
						onChange: (e) => setFilter(e.target.value),
						className: "h-9 w-auto min-w-36",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "open",
								children: "Open"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "all",
								children: "All"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "issued",
								children: "Issued"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "due",
								children: "Due"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "overdue",
								children: "Overdue"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "partial",
								children: "Partial"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "paid",
								children: "Paid"
							})
						]
					}) : null
				]
			}),
			tab === "invoices" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Table, {
				headers: [
					"Number",
					"Customer",
					"Total",
					"Remaining",
					"Due",
					"Status"
				],
				rows: visible.map((i) => [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "font-mono text-accent hover:underline",
						onClick: () => openInvoice(i.id),
						children: i.number
					}, i.id),
					i.customer_name,
					kes(i.amount_kes),
					kes(i.remaining_kes),
					i.due_date,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
						tone: statusTone(i.status),
						children: i.status
					}, `${i.id}-st`)
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
			}),
			detail ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InvoicePanel, {
				doc: detail,
				onClose: () => setDetail(null),
				onReload: () => openInvoice(detail.invoice.id)
			}) : null
		]
	});
}
function quotesForCustomer(quotes, customerId) {
	const q = quotes.filter((x) => x.customer_id === customerId);
	if (q.length === 0) return [{
		description: "Internet service",
		quantity: 1,
		unit_kes: 2500
	}];
	return q.map((x) => ({
		description: `${x.package_name} (${x.billing_interval})`,
		quantity: 1,
		unit_kes: x.price_kes,
		package_id: x.package_id,
		service_id: x.service_id
	}));
}
function Stat({ label, value, sub, tone }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-xl border border-border bg-surface p-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-xs tracking-wide text-muted uppercase",
				children: label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: `mt-2 font-mono text-2xl tabular-nums ${tone === "danger" ? "text-danger" : ""}`,
				children: value
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-1 text-xs text-subtle",
				children: sub
			})
		]
	});
}
function InvoicePanel({ doc, onClose, onReload }) {
	const inv = doc.invoice;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-xl border border-border bg-surface p-5",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-start justify-between gap-3 print:hidden",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs tracking-wide text-accent uppercase",
						children: doc.tenant.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "text-xl font-semibold",
						children: inv.number
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm text-muted",
						children: [
							doc.customer?.name,
							" · ",
							doc.customer?.phone,
							" · due ",
							inv.due_date
						]
					})
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex gap-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							tone: statusTone(inv.status),
							children: inv.status
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							size: "sm",
							variant: "secondary",
							onClick: () => window.print(),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Printer, { className: "size-4" }), " Print"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "sm",
							variant: "ghost",
							onClick: onClose,
							children: "Close"
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "mt-4 hidden print:block",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "text-2xl font-semibold",
						children: doc.tenant.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm",
						children: [
							inv.number,
							" · ",
							inv.status,
							" · due ",
							inv.due_date
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm",
						children: [
							doc.customer?.name,
							" · ",
							doc.customer?.phone,
							" · ",
							doc.customer?.email
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-4 divide-y divide-border text-sm",
				children: (doc.items.length ? doc.items : [{
					id: "one",
					description: "Internet service",
					quantity: 1,
					unit_kes: inv.subtotal_kes || inv.amount_kes,
					amount_kes: inv.subtotal_kes || inv.amount_kes
				}]).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex justify-between gap-3 py-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [item.description, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "text-muted",
						children: [
							" ",
							"· ",
							item.quantity,
							" × ",
							kes(item.unit_kes)
						]
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "font-mono",
						children: kes(item.amount_kes)
					})]
				}, item.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
				className: "mt-3 space-y-1 text-sm",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
							className: "text-muted",
							children: "Subtotal"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
							className: "font-mono",
							children: kes(inv.subtotal_kes || inv.amount_kes)
						})]
					}),
					inv.tax_kes > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dt", {
							className: "text-muted",
							children: [
								"VAT ",
								inv.tax_rate,
								"%"
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
							className: "font-mono",
							children: kes(inv.tax_kes)
						})]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex justify-between font-medium",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "Total" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
							className: "font-mono",
							children: kes(inv.amount_kes)
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
							className: "text-muted",
							children: "Paid"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
							className: "font-mono",
							children: kes(inv.paid_kes)
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
							className: "text-muted",
							children: "Remaining"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
							className: "font-mono",
							children: kes(inv.remaining_kes)
						})]
					})
				]
			}),
			inv.notes ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 text-sm text-muted",
				children: inv.notes
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "mt-6 font-medium",
				children: "Allocations"
			}),
			doc.payments.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 text-sm text-muted",
				children: "No receipts on this invoice yet."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-1 text-sm",
				children: doc.payments.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex justify-between py-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
						p.provider,
						" ",
						p.reference
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "font-mono",
						children: kes(p.amount_kes)
					})]
				}, p.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "mt-4 hidden text-sm text-muted print:hidden",
				onClick: onReload,
				children: "Refresh"
			})
		]
	});
}
function Table({ headers, rows }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "overflow-x-auto rounded-xl border border-border print:hidden",
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
				children: rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
					className: "px-4 py-8 text-muted",
					colSpan: headers.length,
					children: "Nothing in this view."
				}) }) : rows.map((r, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: r.map((c, j) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
					className: "px-4 py-3",
					children: c
				}, j)) }, i))
			})]
		})
	});
}
//#endregion
export { BillingPage as component };
