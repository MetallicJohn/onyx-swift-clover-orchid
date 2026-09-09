import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as askRouterOs } from "./server-more-C5Y0MTly.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { t as Field } from "./input-BJCOk2ZM.mjs";
import { v as listRouters } from "./server-C1t-C6za.mjs";
import { i as queueRouterCommand } from "./server-mikrotik-BLAevoo4.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/ai-DCi8iah7.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function AiPage() {
	const [prompt, setPrompt] = (0, import_react.useState)("Create a PPPoE secret for user1 on profile 10Mbps, disabled=no");
	const [script, setScript] = (0, import_react.useState)("");
	const [model, setModel] = (0, import_react.useState)("");
	const [note, setNote] = (0, import_react.useState)(null);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "MikroTik assistant"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Generates RouterOS v7. Destructive paste still goes through Approve on Routers. Does not push to the device by itself."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid gap-3 rounded-xl border border-border bg-surface p-4",
				onSubmit: async (e) => {
					e.preventDefault();
					setNote(null);
					const r = await askRouterOs({ data: { prompt } });
					setScript(r.script);
					setModel(r.model);
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
					label: "Describe the change",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
						className: "min-h-28 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm",
						value: prompt,
						onChange: (e) => setPrompt(e.target.value)
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "submit",
					children: "Generate script"
				})]
			}),
			script ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs text-muted",
						children: ["Model: ", model]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
						className: "max-h-80 overflow-auto rounded-xl border border-border bg-elevated p-4 text-xs",
						children: script
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "secondary",
						onClick: async () => {
							const id = (await listRouters()).routers[0]?.id;
							if (!id) {
								setNote("Add a router first");
								return;
							}
							await queueRouterCommand({ data: {
								router_id: id,
								kind: "raw.script",
								payload: { script }
							} });
							setNote("Queued as raw.script — Approve it on Routers before the agent pulls.");
						},
						children: "Queue as proposed command"
					}),
					note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-accent",
						children: note
					}) : null
				]
			}) : null
		]
	});
}
//#endregion
export { AiPage as component };
