import { o as __toESM } from "../_runtime.mjs";
import { V as require_react, v as Link, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as createServerFn } from "./ssr.mjs";
import { S as cn, j as kes } from "./access-1saCIo2_.mjs";
import { t as authMiddleware } from "./middleware-Cu1DSXn0.mjs";
import { n as createSsrRpc } from "./router-BJW9Pjuo.mjs";
import { _ as recordPlanPayment, b as setPlan, c as getPlan, m as listTicketStaff, o as createStaffAccount, r as changeMemberRole, y as sendPlanStk } from "./server-more-C5Y0MTly.mjs";
import { t as Button } from "./button-Cb8gjdGd.mjs";
import { n as Input, r as Select, t as Field } from "./input-BJCOk2ZM.mjs";
import { A as toggleProvider, E as saveMessaging, N as workspaceSlug, a as checkSmsAccount, k as testMessaging, o as confirmStk, u as getMessaging, y as listProviders } from "./server-ops-Cjhg1W_o.mjs";
import { S as renameTenant, u as getDashboard } from "./server-C1t-C6za.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/settings-DLcfdnuA.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var getKopokopo = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("12b9094c5087afcc1d9bfae5c8dfdc7382133df3ef681bac797e668d052b8149"));
var saveKopokopo = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("f9b3f332043676708e8c1ab892b6e537af272e6db59123681b5b45ef00a5250a"));
var testKopokopo = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(createSsrRpc("478f5a2cbe7fb162522f17a4b64a839c3d313854f8d22bf41c1209c001869e42"));
var getMpesa = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("990333dbf23e6550cd986e3e5ef073cf9327280beb4569e280874e04d7d58e91"));
var saveMpesa = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("913200ff77f29304ee30fd95bdce91cf50202f8ad6a7cffc52bff073a94e9f25"));
var testMpesa = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(createSsrRpc("f0d807a698d32edcb199283a08d28db6460e51f1ebcb7800b41f38cae22eb518"));
var savePublicBase = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createSsrRpc("5df8987459be47db7012716158196d8446f4c78c9e37c54fe59ac95f96aa6213"));
var TABS = [
	{
		id: "company",
		label: "Company info"
	},
	{
		id: "sms",
		label: "SMS"
	},
	{
		id: "payment",
		label: "Payment"
	},
	{
		id: "plan",
		label: "Plan"
	},
	{
		id: "staff",
		label: "Staff"
	}
];
var EMPTY_MSG = {
	payment_sms: true,
	payment_whatsapp: true,
	billing_sms: true,
	billing_whatsapp: false,
	sms_provider: "africastalking",
	sms_sender_id: "",
	sms_username: "",
	sms_api_key: "",
	sms_sandbox: true,
	wa_provider: "meta",
	wa_phone_id: "",
	wa_access_token: "",
	wa_business_id: "",
	wa_sandbox: true
};
function Check({ label, checked, onChange }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			type: "checkbox",
			checked,
			onChange: (e) => onChange(e.target.checked)
		}), label]
	});
}
function SettingsPage() {
	const [tab, setTab] = (0, import_react.useState)("company");
	const [ws, setWs] = (0, import_react.useState)(null);
	const [form, setForm] = (0, import_react.useState)({
		name: "",
		supportEmail: "",
		supportPhone: ""
	});
	const [slug, setSlug] = (0, import_react.useState)("");
	const [providers, setProviders] = (0, import_react.useState)([]);
	const [msg, setMsg] = (0, import_react.useState)(EMPTY_MSG);
	const [smsHint, setSmsHint] = (0, import_react.useState)("");
	const [waHint, setWaHint] = (0, import_react.useState)("");
	const [testPhone, setTestPhone] = (0, import_react.useState)("");
	const [testOut, setTestOut] = (0, import_react.useState)(null);
	const [saved, setSaved] = (0, import_react.useState)(null);
	const [kopo, setKopo] = (0, import_react.useState)({
		enabled: true,
		sandbox: true,
		client_id: "",
		client_secret: "",
		till_number: ""
	});
	const [kopoHint, setKopoHint] = (0, import_react.useState)("");
	const [kopoOut, setKopoOut] = (0, import_react.useState)(null);
	const [mpesa, setMpesa] = (0, import_react.useState)({
		enabled: true,
		sandbox: true,
		client_id: "",
		client_secret: "",
		till_number: "",
		passkey: "",
		stk_type: "paybill"
	});
	const [mpesaSecretHint, setMpesaSecretHint] = (0, import_react.useState)("");
	const [mpesaPassHint, setMpesaPassHint] = (0, import_react.useState)("");
	const [mpesaOut, setMpesaOut] = (0, import_react.useState)(null);
	const [publicBase, setPublicBase] = (0, import_react.useState)("");
	const [mpesaCallback, setMpesaCallback] = (0, import_react.useState)("");
	const [kopoCallback, setKopoCallback] = (0, import_react.useState)("");
	const [plan, setPlanState] = (0, import_react.useState)(null);
	const [staff, setStaff] = (0, import_react.useState)([]);
	const [staffForm, setStaffForm] = (0, import_react.useState)({
		name: "",
		email: "",
		password: "",
		role: "technician"
	});
	const [staffErr, setStaffErr] = (0, import_react.useState)(null);
	const [staffBusy, setStaffBusy] = (0, import_react.useState)(false);
	const [planRef, setPlanRef] = (0, import_react.useState)("");
	const [planStk, setPlanStk] = (0, import_react.useState)(null);
	const [planErr, setPlanErr] = (0, import_react.useState)(null);
	async function load() {
		const [d, s, p, m, k, daraja, sub, st] = await Promise.all([
			getDashboard(),
			workspaceSlug(),
			listProviders(),
			getMessaging(),
			getKopokopo(),
			getMpesa(),
			getPlan(),
			listTicketStaff()
		]);
		setWs(d.workspace);
		setSlug(s.slug);
		setProviders(p.providers);
		setForm({
			name: d.workspace.tenantName,
			supportEmail: d.workspace.supportEmail,
			supportPhone: d.workspace.supportPhone
		});
		setTestPhone(d.workspace.supportPhone || "");
		setMsg({
			payment_sms: m.payment_sms,
			payment_whatsapp: m.payment_whatsapp,
			billing_sms: m.billing_sms,
			billing_whatsapp: m.billing_whatsapp,
			sms_provider: m.sms_provider,
			sms_sender_id: m.sms_sender_id,
			sms_username: m.sms_username,
			sms_api_key: m.sms_api_key_hint,
			sms_sandbox: m.sms_sandbox,
			wa_provider: m.wa_provider,
			wa_phone_id: m.wa_phone_id,
			wa_access_token: m.wa_token_hint,
			wa_business_id: m.wa_business_id,
			wa_sandbox: m.wa_sandbox
		});
		setSmsHint(m.sms_api_key_set ? m.sms_api_key_hint : "");
		setWaHint(m.wa_token_set ? m.wa_token_hint : "");
		setKopo({
			enabled: k.enabled,
			sandbox: k.sandbox,
			client_id: k.client_id,
			client_secret: k.client_secret_hint,
			till_number: k.till_number
		});
		setKopoHint(k.client_secret_set ? k.client_secret_hint : "");
		setMpesa({
			enabled: daraja.enabled,
			sandbox: daraja.sandbox,
			client_id: daraja.client_id,
			client_secret: daraja.client_secret_hint,
			till_number: daraja.till_number,
			passkey: daraja.passkey_hint,
			stk_type: daraja.stk_type
		});
		setMpesaSecretHint(daraja.client_secret_set ? daraja.client_secret_hint : "");
		setMpesaPassHint(daraja.passkey_set ? daraja.passkey_hint : "");
		setPublicBase(daraja.public_base_url || (typeof window !== "undefined" ? window.location.origin : ""));
		setMpesaCallback(daraja.callback_url);
		setKopoCallback(daraja.kopokopo_callback_url);
		setPlanState(sub);
		setStaff(st.staff);
	}
	(0, import_react.useEffect)(() => {
		load().catch(console.error);
	}, []);
	async function saveMsg(e) {
		e.preventDefault();
		setSaved(null);
		await saveMessaging({ data: msg });
		setSaved("Messaging saved.");
		await load();
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-semibold tracking-tight",
				children: "Settings"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Company profile, SMS gateways, and payment rails."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				role: "tablist",
				"aria-label": "Settings sections",
				className: "flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1",
				children: TABS.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					role: "tab",
					"aria-selected": tab === t.id,
					className: cn("h-11 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors", tab === t.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg"),
					onClick: () => {
						setTab(t.id);
						setSaved(null);
					},
					children: t.label
				}, t.id))
			}),
			tab === "company" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4",
				onSubmit: async (e) => {
					e.preventDefault();
					await renameTenant({ data: form });
					await load();
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-medium",
						children: "Company info"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "ISP name",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.name,
							onChange: (e) => setForm({
								...form,
								name: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Support email",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.supportEmail,
							onChange: (e) => setForm({
								...form,
								supportEmail: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Support phone",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: form.supportPhone,
							onChange: (e) => setForm({
								...form,
								supportPhone: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs text-subtle",
						children: [
							"Role: ",
							ws?.role,
							" · Plan: ",
							ws?.status,
							" · Customer portal slug:",
							" ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-fg",
								children: slug
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm text-muted",
						children: [
							"Customers sign in at",
							" ",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/portal",
								className: "text-accent hover:underline",
								children: "/portal"
							}),
							"."
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: "Save company"
					})
				]
			}) : null,
			tab === "sms" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4",
				onSubmit: saveMsg,
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-medium",
						children: "SMS"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: "Gateway used for receipts and billing reminders. WhatsApp is on the same save."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid gap-2 sm:grid-cols-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								label: "Payment receipts · SMS",
								checked: msg.payment_sms,
								onChange: (v) => setMsg({
									...msg,
									payment_sms: v
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								label: "Billing reminders · SMS",
								checked: msg.billing_sms,
								onChange: (v) => setMsg({
									...msg,
									billing_sms: v
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								label: "Payment receipts · WhatsApp",
								checked: msg.payment_whatsapp,
								onChange: (v) => setMsg({
									...msg,
									payment_whatsapp: v
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								label: "Billing reminders · WhatsApp",
								checked: msg.billing_whatsapp,
								onChange: (v) => setMsg({
									...msg,
									billing_whatsapp: v
								})
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Provider",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							value: msg.sms_provider,
							onChange: (e) => setMsg({
								...msg,
								sms_provider: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "blessedtexts",
									children: "Blessed Texts"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "talksasa",
									children: "Talksasa"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "webfam",
									children: "Webfam SMS"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "africastalking",
									children: "Africa's Talking"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "advanta",
									children: "Advanta SMS"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "twilio",
									children: "Twilio"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-subtle",
						children: msg.sms_provider === "talksasa" ? "Talksasa: API token from bulksms.talksasa.com. Sender ID max 11 characters." : msg.sms_provider === "blessedtexts" ? "Blessed Texts: Partner ID + API key. Sender ID is your approved short name." : msg.sms_provider === "webfam" ? "WebfamSMS: Bearer API key (WFK-…). POST /api/v1/sms/send" : msg.sms_provider === "twilio" ? "Twilio: Account SID as username, Auth Token as API key." : "Username / partner ID plus API key from the provider dashboard."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Sender ID / shortcode",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							placeholder: "GRIDLINE",
							value: msg.sms_sender_id,
							onChange: (e) => setMsg({
								...msg,
								sms_sender_id: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: msg.sms_provider === "twilio" ? "Account SID" : msg.sms_provider === "talksasa" || msg.sms_provider === "webfam" ? "Account (optional)" : "Partner ID / username",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: msg.sms_username,
							onChange: (e) => setMsg({
								...msg,
								sms_username: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "API key",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "password",
							autoComplete: "off",
							placeholder: smsHint || (msg.sms_provider === "webfam" ? "WFK-…" : "Paste key"),
							value: msg.sms_api_key,
							onChange: (e) => setMsg({
								...msg,
								sms_api_key: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
						label: "SMS sandbox (log only, do not hit live API)",
						checked: msg.sms_sandbox,
						onChange: (v) => setMsg({
							...msg,
							sms_sandbox: v
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "mt-2 text-sm font-medium",
						children: "WhatsApp Cloud API"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Phone number ID",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							placeholder: "Meta phone number ID",
							value: msg.wa_phone_id,
							onChange: (e) => setMsg({
								...msg,
								wa_phone_id: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "WhatsApp Business Account ID",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							value: msg.wa_business_id,
							onChange: (e) => setMsg({
								...msg,
								wa_business_id: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Access token",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							type: "password",
							autoComplete: "off",
							placeholder: waHint || "Paste token",
							value: msg.wa_access_token,
							onChange: (e) => setMsg({
								...msg,
								wa_access_token: e.target.value
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
						label: "WhatsApp sandbox (log only until go-live)",
						checked: msg.wa_sandbox,
						onChange: (v) => setMsg({
							...msg,
							wa_sandbox: v
						})
					}),
					saved ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-accent",
						children: saved
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						children: "Save messaging"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "mt-2 text-sm font-medium",
						children: "Send a test"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Phone",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							placeholder: "+2547…",
							value: testPhone,
							onChange: (e) => setTestPhone(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "button",
							variant: "secondary",
							onClick: async () => {
								const r = await testMessaging({ data: {
									channel: "sms",
									phone: testPhone
								} });
								setTestOut(`SMS ${r.status} · ${r.detail}`);
							},
							children: "Test SMS"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							type: "button",
							variant: "secondary",
							onClick: async () => {
								const r = await checkSmsAccount();
								setTestOut(`Account ${r.ok ? "ok" : "error"} · ${r.detail}`);
							},
							children: "Check Webfam balance"
						})]
					}),
					testOut ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: testOut
					}) : null
				]
			}) : null,
			tab === "payment" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-6",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "max-w-xl space-y-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-medium",
							children: "Payment providers"
						}), providers.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-medium",
								children: p.label
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "text-xs text-muted",
								children: [
									p.kind,
									" · ",
									p.sandbox ? "sandbox" : "live"
								]
							})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								size: "sm",
								variant: "secondary",
								onClick: async () => {
									await toggleProvider({ data: {
										id: p.id,
										enabled: !p.enabled
									} });
									await load();
								},
								children: p.enabled ? "Enabled" : "Disabled"
							})]
						}, p.id))]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4",
						onSubmit: async (e) => {
							e.preventDefault();
							const urls = await savePublicBase({ data: { public_base_url: publicBase } });
							setMpesaCallback(urls.mpesa);
							setKopoCallback(urls.kopokopo);
							setPublicBase(urls.public_base_url);
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-medium",
								children: "Callback URLs"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-muted",
								children: "Public HTTPS origin Daraja and Kopo Kopo POST to after STK."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Public site URL",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									placeholder: "https://ops.yourisp.co.ke",
									value: publicBase,
									onChange: (e) => setPublicBase(e.target.value)
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "M-Pesa Daraja callback",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									readOnly: true,
									value: mpesaCallback || "Save the public URL to generate this"
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Kopo Kopo callback",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									readOnly: true,
									value: kopoCallback || "Save the public URL to generate this"
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "submit",
								children: "Save public URL"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4",
						onSubmit: async (e) => {
							e.preventDefault();
							setMpesaOut(null);
							await saveMpesa({ data: mpesa });
							setMpesaOut("M-Pesa Daraja saved.");
							await load();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-medium",
								children: "M-Pesa Daraja"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								label: "Enabled",
								checked: mpesa.enabled,
								onChange: (v) => setMpesa({
									...mpesa,
									enabled: v
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								label: "Sandbox",
								checked: mpesa.sandbox,
								onChange: (v) => setMpesa({
									...mpesa,
									sandbox: v
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "STK type",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
									value: mpesa.stk_type,
									onChange: (e) => setMpesa({
										...mpesa,
										stk_type: e.target.value
									}),
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "paybill",
										children: "Paybill (CustomerPayBillOnline)"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "till",
										children: "Till / Buy Goods (CustomerBuyGoodsOnline)"
									})]
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Consumer key",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									value: mpesa.client_id,
									onChange: (e) => setMpesa({
										...mpesa,
										client_id: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Consumer secret",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									type: "password",
									autoComplete: "off",
									placeholder: mpesaSecretHint || "Paste secret",
									value: mpesa.client_secret,
									onChange: (e) => setMpesa({
										...mpesa,
										client_secret: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Shortcode",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									placeholder: "Paybill or till",
									value: mpesa.till_number,
									onChange: (e) => setMpesa({
										...mpesa,
										till_number: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Lipa Na M-Pesa passkey",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									type: "password",
									autoComplete: "off",
									placeholder: mpesaPassHint || "Passkey",
									value: mpesa.passkey,
									onChange: (e) => setMpesa({
										...mpesa,
										passkey: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-xs text-subtle",
								children: ["STK CallBackURL: ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-mono text-fg",
									children: mpesaCallback || "set public URL above"
								})]
							}),
							mpesaOut ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-accent",
								children: mpesaOut
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "submit",
									children: "Save M-Pesa"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "button",
									variant: "secondary",
									onClick: async () => {
										try {
											const r = await testMpesa();
											setMpesaOut(`Token ok on ${r.host} (${r.token_prefix}…)`);
										} catch (ex) {
											setMpesaOut(ex instanceof Error ? ex.message : "Token failed");
										}
									},
									children: "Test token"
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4",
						onSubmit: async (e) => {
							e.preventDefault();
							setKopoOut(null);
							await saveKopokopo({ data: kopo });
							setKopoOut("Kopo Kopo saved.");
							await load();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-medium",
								children: "Kopo Kopo"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								label: "Enabled",
								checked: kopo.enabled,
								onChange: (v) => setKopo({
									...kopo,
									enabled: v
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								label: "Sandbox",
								checked: kopo.sandbox,
								onChange: (v) => setKopo({
									...kopo,
									sandbox: v
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Client ID",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									value: kopo.client_id,
									onChange: (e) => setKopo({
										...kopo,
										client_id: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Client secret",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									type: "password",
									autoComplete: "off",
									placeholder: kopoHint || "Paste secret",
									value: kopo.client_secret,
									onChange: (e) => setKopo({
										...kopo,
										client_secret: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Till / online payments account",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									placeholder: "K000000 or 1234567",
									value: kopo.till_number,
									onChange: (e) => setKopo({
										...kopo,
										till_number: e.target.value
									})
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-xs text-subtle",
								children: [
									"Incoming payment callback:",
									" ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "font-mono text-fg",
										children: kopoCallback || "set public URL above"
									})
								]
							}),
							kopoOut ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-accent",
								children: kopoOut
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "submit",
									children: "Save Kopo Kopo"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "button",
									variant: "secondary",
									onClick: async () => {
										try {
											const r = await testKopokopo();
											setKopoOut(`Token ok on ${r.host} (${r.token_prefix}…)`);
										} catch (ex) {
											setKopoOut(ex instanceof Error ? ex.message : "Token failed");
										}
									},
									children: "Test token"
								})]
							})
						]
					})
				]
			}) : null,
			tab === "plan" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: "Gridline subscription for this ISP. Customer invoices stay on Billing. Paid plans issue an invoice and activate after M-Pesa (Stripe is not used)."
					}),
					planErr ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-danger",
						children: planErr
					}) : null,
					saved && tab === "plan" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-accent",
						children: saved
					}) : null,
					plan ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "rounded-xl border border-border bg-surface p-4 text-sm",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap items-center justify-between gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
								"Current: ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
									className: "capitalize",
									children: plan.plan
								}),
								" (",
								plan.status,
								") · ",
								plan.max_customers,
								" customers ·",
								" ",
								plan.max_routers,
								" routers"
							] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-muted",
								children: plan.plan === "trial" ? plan.trial_expired ? "Trial ended" : `${plan.days_left} day${plan.days_left === 1 ? "" : "s"} left` : plan.period_end ? `Renews ${plan.period_end.slice(0, 10)}` : null
							})]
						})
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid gap-3 md:grid-cols-3",
						children: (plan?.catalog ?? []).map((p) => {
							const current = plan?.plan === p.code && !plan.pending_plan;
							const pending = plan?.pending_plan === p.code;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-col rounded-xl border border-border bg-surface p-4",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs tracking-wide text-accent uppercase",
										children: p.label
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "mt-1 font-mono text-2xl",
										children: p.monthly_kes ? kes(p.monthly_kes) : "Free"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "mt-1 text-sm text-muted",
										children: p.blurb
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "mt-2 text-xs text-subtle",
										children: [
											p.max_customers,
											" customers · ",
											p.max_routers,
											" routers"
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
										className: "mt-4",
										variant: current ? "default" : "secondary",
										disabled: current,
										onClick: async () => {
											setPlanErr(null);
											setSaved(null);
											try {
												const r = await setPlan({ data: { plan: p.code } });
												setPlanState(r);
												setSaved(p.monthly_kes === 0 ? "Trial is active." : r.invoice ? `Invoice ${r.invoice.number} issued. Pay to activate ${p.label}.` : `Plan set to ${p.label}.`);
											} catch (ex) {
												setPlanErr(ex instanceof Error ? ex.message : "Plan change failed");
											}
										},
										children: current ? "Current" : pending ? "Pay to activate" : p.monthly_kes === 0 ? "Switch to trial" : "Select"
									})
								]
							}, p.code);
						})
					}),
					plan?.invoice ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4",
						onSubmit: async (e) => {
							e.preventDefault();
							setPlanErr(null);
							try {
								const r = await recordPlanPayment({ data: {
									invoice_id: plan.invoice.id,
									provider: "mpesa",
									reference: planRef
								} });
								setPlanState(r);
								setPlanRef("");
								setPlanStk(null);
								setSaved(`Paid ${plan.invoice.number}. ${r.plan} is active.`);
							} catch (ex) {
								setPlanErr(ex instanceof Error ? ex.message : "Payment failed");
							}
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
								className: "font-medium",
								children: ["Pay ", plan.invoice.number]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-sm text-muted",
								children: [
									plan.invoice.plan,
									" · ",
									kes(plan.invoice.amount_kes),
									" · due ",
									plan.invoice.due_date,
									". The plan does not change until this is paid."
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "M-Pesa receipt",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									required: true,
									placeholder: "QK7X…",
									value: planRef,
									onChange: (e) => setPlanRef(e.target.value)
								})
							}),
							planErr ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-danger",
								children: planErr
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "submit",
									children: "Record payment"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "button",
									variant: "secondary",
									onClick: async () => {
										setPlanErr(null);
										try {
											const r = await sendPlanStk({ data: {
												invoice_id: plan.invoice.id,
												provider: "mpesa"
											} });
											setPlanStk(r.checkout_id);
											if (r.note) setPlanErr(r.note);
										} catch (ex) {
											setPlanErr(ex instanceof Error ? ex.message : "STK failed");
										}
									},
									children: "Send STK to company phone"
								})]
							}),
							planStk ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-2 text-sm",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-mono",
									children: planStk
								}), planStk.startsWith("ws_") ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "button",
									size: "sm",
									onClick: async () => {
										await confirmStk({ data: { checkout_id: planStk } });
										setPlanStk(null);
										setPlanState(await getPlan());
										setSaved("Platform invoice paid. Plan is active.");
									},
									children: "Simulate Daraja callback"
								}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-muted",
									children: "Waiting for the live callback."
								})]
							}) : null
						]
					}) : null,
					plan?.invoices?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "divide-y divide-border overflow-hidden rounded-xl border border-border text-sm",
						children: plan.invoices.map((inv) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "flex items-center justify-between bg-surface px-4 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
								inv.number,
								" · ",
								inv.plan,
								" · due ",
								inv.due_date
							] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "font-mono",
								children: [
									kes(inv.amount_kes),
									" · ",
									inv.status
								]
							})]
						}, inv.id))
					}) : null
				]
			}) : null,
			tab === "staff" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-6",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2",
					onSubmit: async (e) => {
						e.preventDefault();
						setStaffErr(null);
						setStaffBusy(true);
						try {
							await createStaffAccount({ data: {
								name: staffForm.name,
								email: staffForm.email,
								password: staffForm.password,
								role: staffForm.role
							} });
							setStaffForm({
								name: "",
								email: "",
								password: "",
								role: "technician"
							});
							setSaved("Staff login created. They can sign in with that email and password.");
							await load();
						} catch (err) {
							setStaffErr(err instanceof Error ? err.message : "Could not create staff");
						} finally {
							setStaffBusy(false);
						}
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "sm:col-span-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-medium",
								children: "Create a staff login"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 text-sm text-muted",
								children: "They sign in at the same Gridline login with this email and password. No extra signup needed."
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Name",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								required: true,
								value: staffForm.name,
								onChange: (e) => setStaffForm({
									...staffForm,
									name: e.target.value
								}),
								placeholder: "Kamau Otieno"
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Email",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								type: "email",
								required: true,
								value: staffForm.email,
								onChange: (e) => setStaffForm({
									...staffForm,
									email: e.target.value
								}),
								placeholder: "tech@isp.co.ke"
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Temporary password",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								type: "password",
								required: true,
								minLength: 8,
								value: staffForm.password,
								onChange: (e) => setStaffForm({
									...staffForm,
									password: e.target.value
								}),
								autoComplete: "new-password",
								placeholder: "At least 8 characters"
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
							label: "Role",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
								value: staffForm.role,
								onChange: (e) => setStaffForm({
									...staffForm,
									role: e.target.value
								}),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "isp_admin",
										children: "Admin"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "finance",
										children: "Finance"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "customer_care",
										children: "Customer care"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "network_engineer",
										children: "Network engineer"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "technician",
										children: "Technician"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: "isp_owner",
										children: "Owner"
									})
								]
							})
						}),
						staffErr ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-danger sm:col-span-2",
							children: staffErr
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "sm:col-span-2",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								type: "submit",
								disabled: staffBusy,
								children: staffBusy ? "Creating…" : "Create login"
							})
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
					className: "divide-y divide-border overflow-hidden rounded-xl border border-border",
					children: [staff.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex flex-col gap-2 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-medium",
							children: s.name
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs text-muted",
							children: s.email || s.user_id
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Select, {
							className: "sm:w-52",
							value: s.role,
							onChange: async (e) => {
								try {
									await changeMemberRole({ data: {
										user_id: s.user_id,
										role: e.target.value
									} });
									await load();
								} catch (err) {
									setStaffErr(err instanceof Error ? err.message : "Could not change role");
								}
							},
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "isp_owner",
									children: "Owner"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "isp_admin",
									children: "Admin"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "finance",
									children: "Finance"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "customer_care",
									children: "Customer care"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "network_engineer",
									children: "Network engineer"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "technician",
									children: "Technician"
								})
							]
						})]
					}, s.user_id)), staff.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
						className: "px-4 py-6 text-sm text-muted",
						children: "No members yet."
					}) : null]
				})]
			}) : null
		]
	});
}
//#endregion
export { SettingsPage as component };
