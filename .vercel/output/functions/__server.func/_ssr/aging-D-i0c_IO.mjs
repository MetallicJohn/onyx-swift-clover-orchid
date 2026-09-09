import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/aging-D-i0c_IO.js
var aging_exports = /* @__PURE__ */ __exportAll({
	invoiceAging: () => invoiceAging,
	invoiceOpenAmount: () => invoiceOpenAmount,
	tallyAging: () => tallyAging
});
function invoiceAging(status, dueDate, today = /* @__PURE__ */ new Date()) {
	if (status === "paid") return "paid";
	const due = new Date(dueDate);
	if (Number.isNaN(due.getTime())) return "current";
	const days = Math.floor((today.getTime() - due.getTime()) / 864e5);
	if (days <= 0) return "current";
	if (days <= 30) return "1-30";
	if (days <= 60) return "31-60";
	return "60+";
}
function invoiceOpenAmount(row) {
	if (row.status === "paid") return 0;
	return Math.max(0, row.amount_kes - (row.paid_kes ?? 0));
}
function tallyAging(rows, today = /* @__PURE__ */ new Date()) {
	const out = {
		current: {
			count: 0,
			amount: 0
		},
		"1-30": {
			count: 0,
			amount: 0
		},
		"31-60": {
			count: 0,
			amount: 0
		},
		"60+": {
			count: 0,
			amount: 0
		},
		paid: {
			count: 0,
			amount: 0
		}
	};
	for (const r of rows) {
		const b = invoiceAging(r.status, r.due_date, today);
		out[b].count += 1;
		out[b].amount += b === "paid" ? r.amount_kes : invoiceOpenAmount(r);
	}
	return out;
}
//#endregion
export { tallyAging as n, aging_exports as t };
