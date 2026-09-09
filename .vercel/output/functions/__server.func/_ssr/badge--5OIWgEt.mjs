import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as cn } from "./rls-stkZtAMF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/badge--5OIWgEt.js
var import_jsx_runtime = require_jsx_runtime();
var tones = {
	ok: "bg-ok/15 text-ok",
	warn: "bg-warn/15 text-warn",
	danger: "bg-danger/15 text-danger",
	muted: "bg-elevated text-muted",
	accent: "bg-accent/15 text-accent"
};
function Badge({ tone = "muted", className, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", tones[tone] ?? tones.muted, className),
		children
	});
}
/** Map a domain status string onto Badge tone classes. */
function statusTone(status) {
	const s = status.toLowerCase();
	if ([
		"active",
		"paid",
		"connected",
		"resolved",
		"closed",
		"confirmed"
	].includes(s)) return "ok";
	if ([
		"grace",
		"due",
		"issued",
		"pending",
		"assigned",
		"travelling",
		"degraded",
		"on_site"
	].includes(s)) return "warn";
	if ([
		"suspended",
		"overdue",
		"offline",
		"urgent",
		"terminated"
	].includes(s)) return "danger";
	return "muted";
}
//#endregion
export { statusTone as n, Badge as t };
