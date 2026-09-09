import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { d as linkReseller, v as redeemPoints } from "./server-more-C5Y0MTly.mjs";
import { n as statusTone, t as Badge } from "./badge-BO-VQeJb.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, r as Select, t as Field } from "./input-BJCOk2ZM.mjs";
import { i as addReseller, r as addReferral, v as listPartners } from "./server-ops-Cjhg1W_o.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/partners-CIhTJi-K.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function PartnersPage() {
	const [tab, setTab] = (0, import_react.useState)("loyalty");
	const [data, setData] = (0, import_react.useState)(null);
	const [ref, setRef] = (0, import_react.useState)({
		referrer_id: "",
		referee_name: "",
		referee_phone: ""
	});
	const [rs, setRs] = (0, import_react.useState)({
		name: "",
		phone: "",
		commission_pct: 10
	});
	const [link, setLink] = (0, import_react.useState)({
		customer_id: "",
		reseller_id: ""
	});
	async function load() {
		const r = await listPartners();
		setData(r);
		if (!ref.referrer_id && r.customers[0]) setRef((f) => ({
			...f,
			referrer_id: r.customers[0].id
		}));
		if (!link.customer_id && r.customers[0]) setLink({
			customer_id: r.customers[0].id,
			reseller_id: r.resellers[0]?.id ?? ""
		});
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "text-muted",
		children: "Loading…"
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Partners"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Loyalty points accrue on payment. Referrals and resellers are separate modules."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-wrap gap-2",
				children: [
					"loyalty",
					"referrals",
					"resellers"
				].map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					size: "sm",
					variant: tab === t ? "default" : "secondary",
					onClick: () => setTab(t),
					children: t
				}, t))
			}),
			tab === "loyalty" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "divide-y divide-border overflow-hidden rounded-xl border border-border",
				children: [data.loyalty.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex items-center justify-between bg-surface px-4 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-medium",
						children: l.customer_name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-xs text-muted",
						children: l.phone
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "font-mono",
							children: [l.points, " pts"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "sm",
							variant: "ghost",
							onClick: async () => {
								await redeemPoints({ data: {
									customer_id: l.customer_id,
									points: Math.min(100, l.points)
								} });
								await load();
							},
							children: "Redeem 100"
						})]
					})]
				}, l.phone)), data.loyalty.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "px-4 py-6 text-sm text-muted",
					children: "Points appear after confirmed payments."
				}) : null]
			}) : null,
			tab === "referrals" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-3",
					onSubmit: async (e) => {
						e.preventDefault();
						await addReferral({ data: ref });
						setRef({
							...ref,
							referee_name: "",
							referee_phone: ""
						});
						await load();
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Referrer",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, {
								value: ref.referrer_id,
								onChange: (e) => setRef({
									...ref,
									referrer_id: e.target.value
								}),
								children: data.customers.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: c.id,
									children: c.name
								}, c.id))
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "New customer",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								required: true,
								value: ref.referee_name,
								onChange: (e) => setRef({
									...ref,
									referee_name: e.target.value
								})
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Phone",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								value: ref.referee_phone,
								onChange: (e) => setRef({
									...ref,
									referee_phone: e.target.value
								})
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "submit",
							children: "Log referral"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "space-y-2",
					children: data.referrals.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-medium",
							children: r.referee_name
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-xs text-muted",
							children: ["via ", r.referrer]
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, {
							tone: statusTone(r.status),
							children: [
								r.points,
								" pts · ",
								r.status
							]
						})]
					}, r.id))
				})]
			}) : null,
			tab === "resellers" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-3",
						onSubmit: async (e) => {
							e.preventDefault();
							await addReseller({ data: rs });
							setRs({
								name: "",
								phone: "",
								commission_pct: 10
							});
							await load();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Name",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									required: true,
									value: rs.name,
									onChange: (e) => setRs({
										...rs,
										name: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Phone",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									value: rs.phone,
									onChange: (e) => setRs({
										...rs,
										phone: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Commission %",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									type: "number",
									value: rs.commission_pct,
									onChange: (e) => setRs({
										...rs,
										commission_pct: Number(e.target.value)
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "submit",
								children: "Add reseller"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-3",
						onSubmit: async (e) => {
							e.preventDefault();
							if (!link.customer_id || !link.reseller_id) return;
							await linkReseller({ data: link });
							await load();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Customer",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, {
									value: link.customer_id,
									onChange: (e) => setLink({
										...link,
										customer_id: e.target.value
									}),
									children: data.customers.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: c.id,
										children: c.name
									}, c.id))
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Reseller",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Select, {
									value: link.reseller_id,
									onChange: (e) => setLink({
										...link,
										reseller_id: e.target.value
									}),
									children: data.resellers.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: r.id,
										children: r.name
									}, r.id))
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "flex items-end",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "submit",
									children: "Attach for commission"
								})
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid gap-3 md:grid-cols-2",
						children: data.resellers.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
							className: "rounded-xl border border-border bg-surface p-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "font-medium",
									children: r.name
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "text-sm text-muted",
									children: [
										r.phone,
										" · ",
										r.commission_pct,
										"% · wallet KES ",
										r.balance_kes ?? 0
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
									tone: statusTone(r.status),
									children: r.status
								})
							]
						}, r.id))
					})
				]
			}) : null
		]
	});
}
//#endregion
export { PartnersPage as component };
