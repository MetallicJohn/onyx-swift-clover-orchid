import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as createServerFn } from "./ssr.mjs";
import { n as statusTone, t as Badge } from "./badge--5OIWgEt.mjs";
import { t as Button } from "./button-CL6xUAzZ.mjs";
import { n as Input, r as Select, t as Field } from "./input-D9suXaeu.mjs";
import { t as authMiddleware } from "./middleware-BuXiR3_1.mjs";
import { n as createSsrRpc } from "./router-CtSkafEx.mjs";
import { O as simulateAgentPull, h as listAgentQueue } from "./server-ops-Buma6roM.mjs";
import { g as listRouters, t as addRouter } from "./server-Dc13Q75o.mjs";
import { a as runRouterApi, i as queueRouterCommand, n as getRouterApi, o as saveRouterApi, r as previewRouterCommand, t as approveRouterCommand } from "./server-mikrotik-CcoJ4Q0v.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routers-Dzk1JRSc.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var updateRouter = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("88ab3927a37c1a5fb45d409fb855f48ce6963999678eb1a80ed60a8639a99c99"));
var copyRouterScript = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("13ab33f1cc1d5e511d9e4a1b9aa78f476539680d32af0bd48396cc83e93d6534"));
var EMPTY = {
	name: "",
	location: "",
	identity: "",
	role: "access"
};
async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
function RoutersPage() {
	const [rows, setRows] = (0, import_react.useState)([]);
	const [form, setForm] = (0, import_react.useState)(EMPTY);
	const [editingId, setEditingId] = (0, import_react.useState)(null);
	const [script, setScript] = (0, import_react.useState)(null);
	const [scriptLabel, setScriptLabel] = (0, import_react.useState)("");
	const [copied, setCopied] = (0, import_react.useState)(false);
	const [commands, setCommands] = (0, import_react.useState)([]);
	const [apiRouter, setApiRouter] = (0, import_react.useState)("");
	const [api, setApi] = (0, import_react.useState)({
		api_user: "gridline",
		api_password: "",
		api_port: 443,
		api_host: "",
		json_pull: "",
		script_pull: "",
		api_password_hint: ""
	});
	const [cmd, setCmd] = (0, import_react.useState)({
		kind: "pppoe.upsert",
		username: "",
		password: "",
		static_ip: "",
		package: "default",
		script: ""
	});
	const [preview, setPreview] = (0, import_react.useState)("");
	const [apiOut, setApiOut] = (0, import_react.useState)(null);
	async function load() {
		const [res, q] = await Promise.all([listRouters(), listAgentQueue()]);
		setRows(res.routers);
		setCommands(q.commands);
		setApiRouter((current) => current || res.routers[0]?.id || "");
	}
	(0, import_react.useEffect)(() => {
		let cancelled = false;
		(async () => {
			const [res, q] = await Promise.all([listRouters(), listAgentQueue()]);
			if (cancelled) return;
			setRows(res.routers);
			setCommands(q.commands);
			setApiRouter((current) => current || res.routers[0]?.id || "");
		})().catch(console.error);
		return () => {
			cancelled = true;
		};
	}, []);
	(0, import_react.useEffect)(() => {
		if (!apiRouter) return;
		getRouterApi({ data: { router_id: apiRouter } }).then((info) => {
			setApi({
				api_user: info.api_user,
				api_password: info.api_password_hint,
				api_port: info.api_port,
				api_host: info.api_host,
				json_pull: info.json_pull,
				script_pull: info.script_pull,
				api_password_hint: info.api_password_hint
			});
		}).catch(console.error);
	}, [apiRouter]);
	async function showScript(text, label, copy = true) {
		setScript(text);
		setScriptLabel(label);
		if (copy) {
			const ok = await copyText(text);
			setCopied(ok);
			if (ok) setTimeout(() => setCopied(false), 2500);
		}
	}
	async function submit(e) {
		e.preventDefault();
		if (editingId) {
			const saved = await updateRouter({ data: {
				id: editingId,
				...form
			} });
			setEditingId(null);
			setForm(EMPTY);
			await showScript(saved.script, `Updated · paste on ${form.name}`, false);
			await load();
			return;
		}
		await showScript((await addRouter({ data: form })).script, `New router · paste on ${form.name}`);
		setForm(EMPTY);
		await load();
	}
	function startEdit(r) {
		setEditingId(r.id);
		setForm({
			name: r.name,
			location: r.location,
			identity: r.identity,
			role: r.role
		});
		window.scrollTo({
			top: 0,
			behavior: "smooth"
		});
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Routers"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Agent + WireGuard model. Routers never expose API ports to the public internet. Copy the RouterOS script whenever you enroll a fresh or factory-reset device."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				onSubmit: submit,
				className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "md:col-span-2 font-medium",
						children: editingId ? "Edit router" : "Add router"
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
						label: "Location",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.location,
							onChange: (e) => setForm({
								...form,
								location: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Identity",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.identity,
							onChange: (e) => setForm({
								...form,
								identity: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Role",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: form.role,
							onChange: (e) => setForm({
								...form,
								role: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "core",
									children: "Core"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "edge",
									children: "Edge"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "access",
									children: "Access"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "hotspot",
									children: "Hotspot"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "submit",
							children: editingId ? "Save router" : "Add router"
						}), editingId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "button",
							variant: "secondary",
							onClick: () => {
								setEditingId(null);
								setForm(EMPTY);
							},
							children: "Cancel"
						}) : null]
					})
				]
			}),
			script ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "space-y-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-center justify-between gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: scriptLabel || "RouterOS v7 script — paste in New Terminal or /import"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: "secondary",
						onClick: async () => {
							await showScript(script, scriptLabel);
						},
						children: copied ? "Copied" : "Copy script"
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
					className: "overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg",
					children: script
				})]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "overflow-x-auto rounded-xl border border-border",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
					className: "w-full min-w-[40rem] text-left text-sm",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", {
						className: "bg-surface text-xs text-muted",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "Router"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "Role"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "WireGuard"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "CPU"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "px-4 py-3 font-medium",
								children: "Uptime"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { className: "px-4 py-3 font-medium" })
						] })
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", {
						className: "divide-y divide-border",
						children: rows.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "px-4 py-3",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: r.name }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "text-xs text-muted",
									children: [r.identity, r.location ? ` · ${r.location}` : ""]
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3 capitalize",
								children: r.role
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
									tone: statusTone(r.wg_status),
									children: r.wg_status
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "px-4 py-3 font-mono",
								children: [r.cpu_pct, "%"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
								className: "px-4 py-3 font-mono",
								children: [r.uptime_hours, "h"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "px-4 py-3",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex flex-wrap justify-end gap-2",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
											size: "sm",
											variant: "secondary",
											onClick: () => startEdit(r),
											children: "Edit"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
											size: "sm",
											variant: "secondary",
											onClick: () => setApiRouter(r.id),
											children: "API"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
											size: "sm",
											variant: "secondary",
											onClick: async () => {
												await showScript((await copyRouterScript({ data: { id: r.id } })).script, `Enroll ${r.name}`);
											},
											children: "Copy script"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
											size: "sm",
											variant: "secondary",
											onClick: async () => {
												await showScript((await copyRouterScript({ data: {
													id: r.id,
													rotate: true
												} })).script, `Fresh enroll token · ${r.name}`);
												await load();
											},
											children: "New token"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
											size: "sm",
											variant: "secondary",
											onClick: async () => {
												await showScript((await simulateAgentPull({ data: { router_id: r.id } })).script, `Agent pull · ${r.name}`, false);
												await load();
											},
											children: "Agent pull"
										})
									]
								})
							})
						] }, r.id))
					})]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2",
				onSubmit: async (e) => {
					e.preventDefault();
					if (!apiRouter) return;
					setApiOut(null);
					await saveRouterApi({ data: {
						router_id: apiRouter,
						api_user: api.api_user,
						api_password: api.api_password,
						api_port: Number(api.api_port) || 443,
						api_host: api.api_host
					} });
					setApiOut("RouterOS API credentials saved. Agent still pulls over WireGuard; REST is optional for a jump host.");
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "md:col-span-2 font-medium",
						children: "MikroTik API"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "md:col-span-2 text-sm text-muted",
						children: "Commands compile to RouterOS v7 REST and a .rsc script. The router agent pulls them with the enroll token — the SaaS never needs the WAN API port open."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Router",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: apiRouter,
							onChange: async (e) => {
								const id = e.target.value;
								setApiRouter(id);
								if (!id) return;
								const info = await getRouterApi({ data: { router_id: id } });
								setApi({
									api_user: info.api_user,
									api_password: info.api_password_hint,
									api_port: info.api_port,
									api_host: info.api_host,
									json_pull: info.json_pull,
									script_pull: info.script_pull,
									api_password_hint: info.api_password_hint
								});
							},
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "",
								children: "Select"
							}), rows.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: r.id,
								children: r.name
							}, r.id))]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "API user",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: api.api_user,
							onChange: (e) => setApi({
								...api,
								api_user: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "API password",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "password",
							autoComplete: "off",
							placeholder: api.api_password_hint || "REST / www-ssl user",
							value: api.api_password,
							onChange: (e) => setApi({
								...api,
								api_password: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "REST port",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: String(api.api_port),
							onChange: (e) => setApi({
								...api,
								api_port: Number(e.target.value) || 443
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "API host (optional jump)",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							placeholder: "Leave empty — agent executes locally",
							value: api.api_host,
							onChange: (e) => setApi({
								...api,
								api_host: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "JSON pull URL",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							readOnly: true,
							value: api.json_pull || "Set public site URL in Settings"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "RouterOS script pull URL",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							readOnly: true,
							value: api.script_pull || "Set public site URL in Settings"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "md:col-span-2 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "submit",
							children: "Save API"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "button",
							variant: "secondary",
							onClick: async () => {
								if (!apiRouter) return;
								const info = await getRouterApi({ data: { router_id: apiRouter } });
								setApi({
									api_user: info.api_user,
									api_password: info.api_password_hint,
									api_port: info.api_port,
									api_host: info.api_host,
									json_pull: info.json_pull,
									script_pull: info.script_pull,
									api_password_hint: info.api_password_hint
								});
							},
							children: "Load"
						})]
					}),
					apiOut ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "md:col-span-2 text-sm text-accent",
						children: apiOut
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "md:col-span-2 mt-2 text-sm font-medium",
						children: "Queue a command"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Kind",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: cmd.kind,
							onChange: (e) => setCmd({
								...cmd,
								kind: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "pppoe.upsert",
									children: "PPPoE upsert (secret)"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "pppoe.disable",
									children: "PPPoE disable + kick"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "static.upsert",
									children: "Static queue + address-list"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "static.disable",
									children: "Static disable"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "hotspot.upsert",
									children: "Hotspot user upsert"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "hotspot.disable",
									children: "Hotspot disable + kick"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "identity.set",
									children: "Set identity"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "resource.snapshot",
									children: "System resource"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "raw.script",
									children: "Raw RouterOS script"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Username / identity",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: cmd.username,
							onChange: (e) => setCmd({
								...cmd,
								username: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Password",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: cmd.password,
							onChange: (e) => setCmd({
								...cmd,
								password: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Static IP",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: cmd.static_ip,
							onChange: (e) => setCmd({
								...cmd,
								static_ip: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Profile / package",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: cmd.package,
							onChange: (e) => setCmd({
								...cmd,
								package: e.target.value
							})
						})
					}),
					cmd.kind === "raw.script" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Script",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: cmd.script,
							onChange: (e) => setCmd({
								...cmd,
								script: e.target.value
							})
						})
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "md:col-span-2 flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "button",
								variant: "secondary",
								onClick: async () => {
									const p = await previewRouterCommand({ data: {
										kind: cmd.kind,
										payload: {
											username: cmd.username,
											name: cmd.username,
											identity: cmd.username,
											password: cmd.password,
											static_ip: cmd.static_ip,
											package: cmd.package,
											script: cmd.script
										},
										host: api.api_host,
										user: api.api_user
									} });
									setPreview(`${p.script}\n\n${p.curl || JSON.stringify(p.rest, null, 2)}`);
								},
								children: "Preview REST / script"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "button",
								onClick: async () => {
									if (!apiRouter) return;
									const q = await queueRouterCommand({ data: {
										router_id: apiRouter,
										kind: cmd.kind,
										payload: {
											username: cmd.username,
											name: cmd.username,
											identity: cmd.username,
											password: cmd.password,
											static_ip: cmd.static_ip,
											package: cmd.package,
											script: cmd.script
										}
									} });
									setPreview(q.script);
									setApiOut(`Queued ${q.id}`);
									await load();
								},
								children: "Queue for agent"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "button",
								variant: "secondary",
								onClick: async () => {
									if (!apiRouter) return;
									const r = await runRouterApi({ data: {
										router_id: apiRouter,
										kind: cmd.kind,
										payload: {
											username: cmd.username,
											name: cmd.username,
											identity: cmd.username,
											password: cmd.password,
											static_ip: cmd.static_ip,
											package: cmd.package,
											script: cmd.script
										}
									} });
									setPreview(JSON.stringify(r, null, 2));
									setApiOut(r.simulated ? "Simulated (no API host)" : "REST executed");
								},
								children: "Run REST now"
							})
						]
					}),
					preview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
						className: "md:col-span-2 overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg",
						children: preview
					}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "mb-3 font-medium",
				children: "Agent command queue"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "divide-y divide-border overflow-hidden rounded-xl border border-border",
				children: [commands.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
					className: "px-4 py-6 text-sm text-muted",
					children: "No commands yet. Provision or suspend a service."
				}) : null, commands.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex items-center justify-between gap-3 bg-surface px-4 py-3 text-sm",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "font-mono text-xs",
						children: c.kind
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-xs text-muted",
						children: c.router_name
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [c.status === "proposed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "sm",
							variant: "secondary",
							onClick: async () => {
								await approveRouterCommand({ data: { id: c.id } });
								await load();
							},
							children: "Approve"
						}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							tone: statusTone(c.status === "acked" ? "active" : "pending"),
							children: c.status
						})]
					})]
				}, c.id))]
			})] })
		]
	});
}
//#endregion
export { RoutersPage as component };
