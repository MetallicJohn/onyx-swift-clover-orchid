import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, v as Link, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { j as kes } from "./access-1saCIo2_.mjs";
import { _ as Handshake } from "../_libs/lucide-react.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, t as Field } from "./input-BJCOk2ZM.mjs";
import { M as verifyResellerLogin, f as getResellerHome, w as requestResellerOtp } from "./server-ops-Cjhg1W_o.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/reseller-B1LBWitp.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function ResellerHome() {
	const [slug, setSlug] = (0, import_react.useState)("");
	const [phone, setPhone] = (0, import_react.useState)("");
	const [code, setCode] = (0, import_react.useState)("");
	const [hint, setHint] = (0, import_react.useState)(null);
	const [token, setToken] = (0, import_react.useState)(null);
	const [home, setHome] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	if (!token || !home) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				to: "/",
				className: "mb-8 flex items-center gap-2 text-sm text-muted",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Handshake, { className: "size-4 text-accent" }), " Gridline reseller"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Commission wallet"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: "ISP slug + the phone on your reseller record. Sandbox code is 000000."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "mt-6 grid gap-3",
				onSubmit: async (e) => {
					e.preventDefault();
					setError(null);
					try {
						if (!hint) {
							const r = await requestResellerOtp({ data: {
								slug,
								phone
							} });
							setHint(r.hint);
						} else {
							const r = await verifyResellerLogin({ data: {
								slug,
								phone,
								code
							} });
							setToken(r.token);
							setHome(await getResellerHome({ data: { token: r.token } }));
						}
					} catch (ex) {
						setError(ex instanceof Error ? ex.message : "Failed");
					}
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "ISP slug",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: slug,
							onChange: (e) => setSlug(e.target.value),
							placeholder: "imani",
							required: true
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Phone",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: phone,
							onChange: (e) => setPhone(e.target.value),
							required: true
						})
					}),
					hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "OTP",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: code,
							onChange: (e) => setCode(e.target.value),
							placeholder: hint,
							required: true
						})
					}) : null,
					error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-danger",
						children: error
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: hint ? "Sign in" : "Send code"
					})
				]
			})
		]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto max-w-lg px-4 py-10",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted",
				children: home.isp.name
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold",
				children: home.reseller.name
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-1 text-sm text-muted",
				children: [home.reseller.commission_pct, "% commission"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 font-mono text-3xl",
				children: kes(home.balance)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "mb-2 font-medium",
					children: "Customers"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
					className: "divide-y divide-border rounded-xl border border-border",
					children: [home.customers.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex justify-between px-4 py-3 text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: c.name }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted",
							children: c.status
						})]
					}, c.id)), home.customers.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
						className: "px-4 py-6 text-sm text-muted",
						children: "No attached customers yet."
					}) : null]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "mb-2 font-medium",
					children: "Wallet"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "text-sm",
					children: home.txs.map((t, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex justify-between py-1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted",
							children: t.reason
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono",
							children: kes(t.delta_kes)
						})]
					}, i))
				})]
			})
		]
	});
}
//#endregion
export { ResellerHome as component };
