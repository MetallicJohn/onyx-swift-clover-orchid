import { o as __toESM } from "../_runtime.mjs";
import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { V as require_react, _ as createRootRoute, b as useRouter, g as createFileRoute, h as lazyRouteComponent, l as Scripts, m as Outlet, p as createRouter, u as HeadContent, x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as getServerFnById, i as TSS_SERVER_FUNCTION, r as createServerFn } from "./ssr.mjs";
import { r as applyRls } from "./rls-stkZtAMF.mjs";
import { L as string, N as number, P as object, R as union, j as literal } from "../_libs/@better-auth/core+[...].mjs";
import { i as getSql } from "./db-BsfBburB.mjs";
import { n as auth } from "./server-284ORu2K.mjs";
import { c as pullCommands, s as heartbeatRouter, t as ackCommands, u as renderAgentScript } from "./mikrotik-CpSXWGZs.mjs";
import { n as handleMpesaCallback, t as handleKopokopoCallback } from "./webhooks-DiK1NaUx.mjs";
import { i as runBillingCycle } from "./notifications-NHmcUGyA.mjs";
import { s as TriangleAlert } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/router-CtSkafEx.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";
function errorMessage(error) {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return FALLBACK_MESSAGE;
}
function AppErrorComponent({ error }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-red-500",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, {
					className: "size-10",
					strokeWidth: 2
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-lg font-semibold",
				children: "Something went wrong"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400",
				children: errorMessage(error)
			})
		]
	});
}
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
/**
* App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
*
*   <AuthProvider><Outlet /></AuthProvider>
*
* Better Auth's React client (`@/lib/auth/client`) needs NO context provider —
* its `useSession()` works standalone — so this is a passthrough today. It's
* kept as the single, stable mount point for any future client-side providers
* (e.g. a toast or theme provider) without churning the root shell.
*/
function AuthProvider({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
}
var CONNECTOR_TOKEN_READY_EVENT = "grok:connector-token-ready";
function isGrokEmbedderOrigin(origin) {
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" && url.protocol !== "http:") return false;
		const host = url.hostname.toLowerCase();
		if (host === "grok.com" || host.endsWith(".grok.com")) return true;
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
		return false;
	} catch {
		return false;
	}
}
function isSandboxPreviewGuestHost(hostname) {
	const host = hostname.toLowerCase();
	return host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com");
}
function isRemintPreviewPair(guestHost, parentHost) {
	const guest = guestHost.toLowerCase();
	const parent = parentHost.toLowerCase();
	const i = guest.indexOf(".preview.");
	if (i <= 0) return false;
	const label = guest.slice(0, i);
	const rest = guest.slice(i + 9);
	if (label.includes(".") || !rest.includes(".")) return false;
	return parent === rest || parent === `grok.${rest}`;
}
function resolveParentEmbedderOrigin(parentIsSelf, referrer, ancestorOrigin, guestHostname = "") {
	if (parentIsSelf) return null;
	for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) try {
		const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		if (isGrokEmbedderOrigin(url.origin)) return url.origin;
		if (isSandboxPreviewGuestHost(guestHostname) || isRemintPreviewPair(guestHostname, url.hostname)) return url.origin;
	} catch {}
	return null;
}
/**
* Guest side of the grok-web ↔ sandbox preview postMessage bridge.
*
* Activates only when this page is framed by an allowlisted Grok embedder.
* Top-level runs (download/export, local `npm run dev`, deployed sites) noop.
*/
var PREVIEW_BRIDGE_CHANNEL = "grok-preview-bridge";
var EnvelopeSchema = object({
	channel: literal(PREVIEW_BRIDGE_CHANNEL),
	version: number().int().positive(),
	type: string().min(1)
});
var HelloSchema = EnvelopeSchema.extend({ type: literal("hello") });
var NavigateSchema = EnvelopeSchema.extend({
	type: literal("navigate"),
	path: string().min(1)
});
var HistorySchema = EnvelopeSchema.extend({
	type: literal("history"),
	delta: union([literal(-1), literal(1)])
});
var ConnectorTokenReadySchema = EnvelopeSchema.extend({ type: literal("connector-token-ready") });
function isSafeBridgePath(path) {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
	try {
		return new URL(path, "https://preview.invalid").origin === "https://preview.invalid";
	} catch {
		return false;
	}
}
/**
* Origin of the Grok embedder framing this page, or null when the page runs
* top-level (download/export, local `npm run dev`, deployed sites) or under a
* non-Grok parent. Client-only; null during SSR.
*/
function resolveCurrentEmbedderOrigin() {
	if (typeof window === "undefined") return null;
	const ancestorOrigin = typeof location.ancestorOrigins !== "undefined" && location.ancestorOrigins.length > 0 ? location.ancestorOrigins[0] : null;
	return resolveParentEmbedderOrigin(window.parent === window, document.referrer, ancestorOrigin, window.location.hostname);
}
/**
* Install host↔guest messaging. Returns a dispose function.
* Noops (returns a no-op dispose) when not embedded under a Grok parent.
*/
function installPreviewHostBridge(options = {}) {
	const parentOrigin = resolveCurrentEmbedderOrigin();
	if (parentOrigin === null) return () => {};
	const ROOT_STATE_KEY = "__grokPreviewBridgeRoot";
	const originalPushState = window.history.pushState.bind(window.history);
	const originalReplaceState = window.history.replaceState.bind(window.history);
	const isAtHistoryRoot = () => {
		const state = window.history.state;
		return Boolean(state && typeof state === "object" && state[ROOT_STATE_KEY] === true);
	};
	try {
		const current = window.history.state;
		if (!(current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, ROOT_STATE_KEY))) {
			const isRoot = window.history.length <= 1;
			originalReplaceState(current && typeof current === "object" ? {
				...current,
				[ROOT_STATE_KEY]: isRoot
			} : { [ROOT_STATE_KEY]: isRoot }, "", window.location.href);
		}
	} catch {}
	const post = (message) => {
		window.parent.postMessage(message, parentOrigin);
	};
	const reportLocation = () => {
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "location",
			path: window.location.pathname || "/",
			search: window.location.search,
			hash: window.location.hash
		});
	};
	const reportRoutes = () => {
		const paths = options.getRoutePaths?.() ?? [];
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "routes",
			paths
		});
	};
	const defaultNavigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		try {
			const url = new URL(path, window.location.origin);
			if (url.origin !== window.location.origin) return;
			const next = `${url.pathname}${url.search}${url.hash}`;
			window.history.pushState(window.history.state, "", next);
			window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
		} catch {}
	};
	const navigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		if (options.navigate) {
			options.navigate(path);
			return;
		}
		defaultNavigate(path);
	};
	const announce = () => {
		reportLocation();
		reportRoutes();
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "ready"
		});
	};
	const onHello = (data) => {
		if (!HelloSchema.safeParse(data).success) return;
		announce();
	};
	const onNavigate = (data) => {
		const parsed = NavigateSchema.safeParse(data);
		if (!parsed.success) return;
		navigate(parsed.data.path);
		queueMicrotask(reportLocation);
	};
	const onHistory = (data) => {
		const parsed = HistorySchema.safeParse(data);
		if (!parsed.success) return;
		if (parsed.data.delta === -1 && isAtHistoryRoot()) return;
		window.history.go(parsed.data.delta);
	};
	const onConnectorTokenReady = (data) => {
		if (!ConnectorTokenReadySchema.safeParse(data).success) return;
		window.dispatchEvent(new Event(CONNECTOR_TOKEN_READY_EVENT));
	};
	const hostMessageHandlers = /* @__PURE__ */ new Map([
		["hello", onHello],
		["navigate", onNavigate],
		["history", onHistory],
		["connector-token-ready", onConnectorTokenReady]
	]);
	const onMessage = (event) => {
		if (event.source !== window.parent) return;
		if (event.origin !== parentOrigin) return;
		const envelope = EnvelopeSchema.safeParse(event.data);
		if (!envelope.success || envelope.data.version !== 1) return;
		hostMessageHandlers.get(envelope.data.type)?.(event.data);
	};
	const onPopState = () => {
		reportLocation();
	};
	const onHashChange = () => {
		reportLocation();
	};
	window.history.pushState = (data, unused, url) => {
		const next = data && typeof data === "object" ? {
			...data,
			[ROOT_STATE_KEY]: false
		} : data;
		originalPushState(next, unused, url);
		reportLocation();
	};
	window.history.replaceState = (data, unused, url) => {
		const next = isAtHistoryRoot() ? {
			...data && typeof data === "object" ? data : {},
			[ROOT_STATE_KEY]: true
		} : data;
		originalReplaceState(next, unused, url);
		reportLocation();
	};
	window.addEventListener("message", onMessage);
	window.addEventListener("popstate", onPopState);
	window.addEventListener("hashchange", onHashChange);
	announce();
	return () => {
		window.removeEventListener("message", onMessage);
		window.removeEventListener("popstate", onPopState);
		window.removeEventListener("hashchange", onHashChange);
		window.history.pushState = originalPushState;
		window.history.replaceState = originalReplaceState;
	};
}
/** Collect static path patterns from a TanStack route tree (best-effort). */
function collectRoutePathsFromTree(routeTree) {
	const paths = /* @__PURE__ */ new Set();
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		const record = node;
		const full = typeof record.fullPath === "string" ? record.fullPath : typeof record.path === "string" ? record.path : null;
		if (full !== null && full !== "") paths.add(full.startsWith("/") ? full : `/${full}`);
		else if (full === "") paths.add("/");
		const children = record.children;
		if (Array.isArray(children)) for (const child of children) walk(child);
		else if (children && typeof children === "object") for (const child of Object.values(children)) walk(child);
	};
	walk(routeTree);
	return [...paths];
}
/**
* Mount once in `__root.tsx` so the Grok preview chrome can drive navigation
* (and later receive registered routes). Noops when the app is not embedded.
*/
function PreviewHostBridge() {
	const router = useRouter();
	(0, import_react.useEffect)(() => {
		return installPreviewHostBridge({
			navigate: (path) => {
				router.history.push(path);
			},
			getRoutePaths: () => collectRoutePathsFromTree(router.routeTree)
		});
	}, [router]);
	return null;
}
var styles_default = "/assets/styles-D-5hMLOR.css";
var APP_NAME = "Gridline";
var fetchSessionUser = createServerFn({ method: "GET" }).handler(createSsrRpc("2c4985e96c199268f7f639534cb5e8e31d6b19d43286bf77416413db60ffde26"));
var Route$34 = createRootRoute({
	beforeLoad: async () => ({ sessionUser: await fetchSessionUser() }),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: APP_NAME },
			{
				name: "theme-color",
				content: "#0a0e13"
			},
			{
				name: "description",
				content: "Multi-tenant ISP operations, billing, and network management."
			}
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg"
			},
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "manifest",
				href: "/__grok/manifest.webmanifest"
			},
			{
				rel: "apple-touch-icon",
				href: "/__grok/icon-180.png"
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Outfit:wght@400;500;600;700&display=swap"
			}
		]
	}),
	component: () => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		suppressHydrationWarning: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PreviewHostBridge, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuthProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {}) }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})
		] })]
	})
});
var $$splitComponentImporter$24 = () => import("./routes-BK3jeiHL.mjs");
var Route$33 = createFileRoute("/")({ component: lazyRouteComponent($$splitComponentImporter$24, "component") });
var $$splitComponentImporter$23 = () => import("./app-BvpXz97M.mjs");
var Route$32 = createFileRoute("/app")({ component: lazyRouteComponent($$splitComponentImporter$23, "component") });
var $$splitComponentImporter$22 = () => import("./login-14mmjkTx.mjs");
var Route$31 = createFileRoute("/login")({ component: lazyRouteComponent($$splitComponentImporter$22, "component") });
var $$splitComponentImporter$21 = () => import("./portal-D2I_E28N.mjs");
var Route$30 = createFileRoute("/portal")({ component: lazyRouteComponent($$splitComponentImporter$21, "component") });
var $$splitComponentImporter$20 = () => import("./reseller-B1OUJadm.mjs");
var Route$29 = createFileRoute("/reseller")({ component: lazyRouteComponent($$splitComponentImporter$20, "component") });
var $$splitComponentImporter$19 = () => import("./app-CMjbG-As.mjs");
var Route$28 = createFileRoute("/app/")({ component: lazyRouteComponent($$splitComponentImporter$19, "component") });
var $$splitComponentImporter$18 = () => import("./acs-DZb6RAKz.mjs");
var Route$27 = createFileRoute("/app/acs")({ component: lazyRouteComponent($$splitComponentImporter$18, "component") });
var $$splitComponentImporter$17 = () => import("./ai-CGcXaTt3.mjs");
var Route$26 = createFileRoute("/app/ai")({ component: lazyRouteComponent($$splitComponentImporter$17, "component") });
var $$splitComponentImporter$16 = () => import("./billing-Duq7oxS6.mjs");
var Route$25 = createFileRoute("/app/billing")({ component: lazyRouteComponent($$splitComponentImporter$16, "component") });
var $$splitComponentImporter$15 = () => import("./customers-CPTD9W2O.mjs");
var Route$24 = createFileRoute("/app/customers")({ component: lazyRouteComponent($$splitComponentImporter$15, "component") });
var $$splitComponentImporter$14 = () => import("./field-1O8PL1-u.mjs");
var Route$23 = createFileRoute("/app/field")({ component: lazyRouteComponent($$splitComponentImporter$14, "component") });
var $$splitComponentImporter$13 = () => import("./hotspot-BcWL-5vQ.mjs");
var Route$22 = createFileRoute("/app/hotspot")({ component: lazyRouteComponent($$splitComponentImporter$13, "component") });
var $$splitComponentImporter$12 = () => import("./import-l6HpeU17.mjs");
var Route$21 = createFileRoute("/app/import")({ component: lazyRouteComponent($$splitComponentImporter$12, "component") });
var $$splitComponentImporter$11 = () => import("./notifications-Cjuco2Lc.mjs");
var Route$20 = createFileRoute("/app/notifications")({ component: lazyRouteComponent($$splitComponentImporter$11, "component") });
var $$splitComponentImporter$10 = () => import("./packages-gYaBxvdG.mjs");
var Route$19 = createFileRoute("/app/packages")({ component: lazyRouteComponent($$splitComponentImporter$10, "component") });
var $$splitComponentImporter$9 = () => import("./partners-ByjkYHal.mjs");
var Route$18 = createFileRoute("/app/partners")({ component: lazyRouteComponent($$splitComponentImporter$9, "component") });
var $$splitComponentImporter$8 = () => import("./radius-BeEct2ze.mjs");
var Route$17 = createFileRoute("/app/radius")({ component: lazyRouteComponent($$splitComponentImporter$8, "component") });
var $$splitComponentImporter$7 = () => import("./reports-B-5-1Qhs.mjs");
var Route$16 = createFileRoute("/app/reports")({ component: lazyRouteComponent($$splitComponentImporter$7, "component") });
var $$splitComponentImporter$6 = () => import("./routers-Dzk1JRSc.mjs");
var Route$15 = createFileRoute("/app/routers")({ component: lazyRouteComponent($$splitComponentImporter$6, "component") });
var $$splitComponentImporter$5 = () => import("./services-CEvOaCYY.mjs");
var Route$14 = createFileRoute("/app/services")({ component: lazyRouteComponent($$splitComponentImporter$5, "component") });
var $$splitComponentImporter$4 = () => import("./settings-veM1T-_d.mjs");
var Route$13 = createFileRoute("/app/settings")({ component: lazyRouteComponent($$splitComponentImporter$4, "component") });
var $$splitComponentImporter$3 = () => import("./statements-CnNlKoAC.mjs");
var Route$12 = createFileRoute("/app/statements")({ component: lazyRouteComponent($$splitComponentImporter$3, "component") });
var $$splitComponentImporter$2 = () => import("./tickets-D_gj3Q_u.mjs");
var Route$11 = createFileRoute("/app/tickets")({ component: lazyRouteComponent($$splitComponentImporter$2, "component") });
var $$splitComponentImporter$1 = () => import("./portal-C8-9yaM6.mjs");
var Route$10 = createFileRoute("/portal/")({ component: lazyRouteComponent($$splitComponentImporter$1, "component") });
var $$splitComponentImporter = () => import("./reseller-BA0tJf13.mjs");
var Route$9 = createFileRoute("/reseller/")({ component: lazyRouteComponent($$splitComponentImporter, "component") });
var Route$8 = createFileRoute("/api/agent/ack")({ server: { handlers: {
	POST: async ({ request }) => {
		const url = new URL(request.url);
		const body = await request.json().catch(() => ({}));
		const token = body.token || url.searchParams.get("token") || "";
		const ids = body.ids || (url.searchParams.get("ids") || "").split(",").filter(Boolean);
		const sql = await getSql();
		const out = await ackCommands(sql, token, ids, body.result || "ok");
		return Response.json(out);
	},
	GET: async ({ request }) => {
		const url = new URL(request.url);
		const token = url.searchParams.get("token") || "";
		const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
		const sql = await getSql();
		const out = await ackCommands(sql, token, ids, "ok");
		return Response.json(out);
	}
} } });
var Route$7 = createFileRoute("/api/agent/heartbeat")({ server: { handlers: {
	POST: async ({ request }) => {
		const url = new URL(request.url);
		const body = await request.json().catch(() => ({}));
		const token = body.token || url.searchParams.get("token") || "";
		const sql = await getSql();
		const out = await heartbeatRouter(sql, token, body);
		return Response.json(out);
	},
	GET: async ({ request }) => {
		const url = new URL(request.url);
		const token = url.searchParams.get("token") || "";
		const sql = await getSql();
		const out = await heartbeatRouter(sql, token, {
			cpu: Number(url.searchParams.get("cpu") || 8),
			uptime_hours: Number(url.searchParams.get("uptime") || 1)
		});
		return Response.json(out);
	}
} } });
function tokenOf(request, url) {
	const q = url.searchParams.get("token") || "";
	const auth = request.headers.get("authorization") || "";
	return q || auth.replace(/^Bearer\s+/i, "");
}
var Route$6 = createFileRoute("/api/agent/pull")({ server: { handlers: {
	GET: async ({ request }) => {
		const token = tokenOf(request, new URL(request.url));
		const sql = await getSql();
		const pulled = await pullCommands(sql, token, true);
		return Response.json(pulled);
	},
	POST: async ({ request }) => {
		const token = tokenOf(request, new URL(request.url));
		const sql = await getSql();
		const pulled = await pullCommands(sql, token, true);
		return Response.json(pulled);
	}
} } });
var Route$5 = createFileRoute("/api/agent/script")({ server: { handlers: { GET: async ({ request }) => {
	const token = new URL(request.url).searchParams.get("token") || "";
	const sql = await getSql();
	const out = await renderAgentScript(sql, token);
	return new Response(out.script, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
} } } });
var Route$4 = createFileRoute("/api/auth/$")({ server: { handlers: {
	GET: ({ request }) => auth.handler(request),
	POST: ({ request }) => auth.handler(request)
} } });
var Route$3 = createFileRoute("/api/v1/health")({ server: { handlers: { GET: async () => {
	let database = "error";
	try {
		await (await getSql())`select 1 as ok`;
		database = "ok";
	} catch {
		database = "error";
	}
	return Response.json({
		ok: database === "ok",
		service: "gridline-web",
		database
	});
} } } });
var Route$2 = createFileRoute("/api/v1/cron/billing")({ server: { handlers: { POST: async ({ request }) => {
	const secret = process.env.CRON_SECRET;
	if (!secret) return Response.json({
		ok: false,
		error: "CRON_SECRET not set"
	}, { status: 503 });
	if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`) return Response.json({
		ok: false,
		error: "unauthorized"
	}, { status: 401 });
	const sql = await getSql();
	await applyRls(sql, { bypass: true });
	const tenants = await sql`select id, name from tenants`;
	const results = [];
	for (const t of tenants) {
		await applyRls(sql, {
			tenantId: t.id,
			bypass: false
		});
		results.push({
			tenant: t.name,
			...await runBillingCycle(sql, t.id, t.name)
		});
	}
	return Response.json({
		ok: true,
		ran: results.length,
		results
	});
} } } });
var hits = /* @__PURE__ */ new Map();
function rateLimit(key, max = 60, windowMs = 6e4) {
	const now = Date.now();
	const row = hits.get(key);
	if (!row || row.reset < now) {
		hits.set(key, {
			n: 1,
			reset: now + windowMs
		});
		return {
			ok: true,
			remaining: max - 1
		};
	}
	if (row.n >= max) return {
		ok: false,
		remaining: 0
	};
	row.n += 1;
	return {
		ok: true,
		remaining: max - row.n
	};
}
var Route$1 = createFileRoute("/api/webhooks/kopokopo/$slug")({ server: { handlers: {
	GET: ({ params }) => Response.json({
		ok: true,
		provider: "kopokopo",
		slug: params.slug
	}),
	POST: async ({ request, params }) => {
		if (!rateLimit(`kopo:${params.slug}`).ok) return Response.json({
			ok: false,
			error: "rate_limited"
		}, { status: 429 });
		const body = await request.json().catch(() => ({}));
		const result = await handleKopokopoCallback(params.slug, body);
		return Response.json(result);
	}
} } });
var Route = createFileRoute("/api/webhooks/mpesa/$slug")({ server: { handlers: {
	GET: ({ params }) => Response.json({
		ok: true,
		provider: "mpesa",
		slug: params.slug
	}),
	POST: async ({ request, params }) => {
		if (!rateLimit(`mpesa:${params.slug}`).ok) return Response.json({
			ResultCode: 1,
			ResultDesc: "Slow down"
		}, { status: 429 });
		const body = await request.json().catch(() => ({}));
		const result = await handleMpesaCallback(params.slug, body);
		return Response.json(result);
	}
} } });
var IndexRoute = Route$33.update({
	id: "/",
	path: "/",
	getParentRoute: () => Route$34
});
var AppRoute = Route$32.update({
	id: "/app",
	path: "/app",
	getParentRoute: () => Route$34
});
var LoginRoute = Route$31.update({
	id: "/login",
	path: "/login",
	getParentRoute: () => Route$34
});
var PortalRoute = Route$30.update({
	id: "/portal",
	path: "/portal",
	getParentRoute: () => Route$34
});
var ResellerRoute = Route$29.update({
	id: "/reseller",
	path: "/reseller",
	getParentRoute: () => Route$34
});
var AppIndexRoute = Route$28.update({
	id: "/",
	path: "/",
	getParentRoute: () => AppRoute
});
var AppAcsRoute = Route$27.update({
	id: "/acs",
	path: "/acs",
	getParentRoute: () => AppRoute
});
var AppAiRoute = Route$26.update({
	id: "/ai",
	path: "/ai",
	getParentRoute: () => AppRoute
});
var AppBillingRoute = Route$25.update({
	id: "/billing",
	path: "/billing",
	getParentRoute: () => AppRoute
});
var AppCustomersRoute = Route$24.update({
	id: "/customers",
	path: "/customers",
	getParentRoute: () => AppRoute
});
var AppFieldRoute = Route$23.update({
	id: "/field",
	path: "/field",
	getParentRoute: () => AppRoute
});
var AppHotspotRoute = Route$22.update({
	id: "/hotspot",
	path: "/hotspot",
	getParentRoute: () => AppRoute
});
var AppImportRoute = Route$21.update({
	id: "/import",
	path: "/import",
	getParentRoute: () => AppRoute
});
var AppNotificationsRoute = Route$20.update({
	id: "/notifications",
	path: "/notifications",
	getParentRoute: () => AppRoute
});
var AppPackagesRoute = Route$19.update({
	id: "/packages",
	path: "/packages",
	getParentRoute: () => AppRoute
});
var AppPartnersRoute = Route$18.update({
	id: "/partners",
	path: "/partners",
	getParentRoute: () => AppRoute
});
var AppRadiusRoute = Route$17.update({
	id: "/radius",
	path: "/radius",
	getParentRoute: () => AppRoute
});
var AppReportsRoute = Route$16.update({
	id: "/reports",
	path: "/reports",
	getParentRoute: () => AppRoute
});
var AppRoutersRoute = Route$15.update({
	id: "/routers",
	path: "/routers",
	getParentRoute: () => AppRoute
});
var AppServicesRoute = Route$14.update({
	id: "/services",
	path: "/services",
	getParentRoute: () => AppRoute
});
var AppSettingsRoute = Route$13.update({
	id: "/settings",
	path: "/settings",
	getParentRoute: () => AppRoute
});
var AppStatementsRoute = Route$12.update({
	id: "/statements",
	path: "/statements",
	getParentRoute: () => AppRoute
});
var AppTicketsRoute = Route$11.update({
	id: "/tickets",
	path: "/tickets",
	getParentRoute: () => AppRoute
});
var PortalIndexRoute = Route$10.update({
	id: "/",
	path: "/",
	getParentRoute: () => PortalRoute
});
var ResellerIndexRoute = Route$9.update({
	id: "/",
	path: "/",
	getParentRoute: () => ResellerRoute
});
var ApiAgentAckRoute = Route$8.update({
	id: "/api/agent/ack",
	path: "/api/agent/ack",
	getParentRoute: () => Route$34
});
var ApiAgentHeartbeatRoute = Route$7.update({
	id: "/api/agent/heartbeat",
	path: "/api/agent/heartbeat",
	getParentRoute: () => Route$34
});
var ApiAgentPullRoute = Route$6.update({
	id: "/api/agent/pull",
	path: "/api/agent/pull",
	getParentRoute: () => Route$34
});
var ApiAgentScriptRoute = Route$5.update({
	id: "/api/agent/script",
	path: "/api/agent/script",
	getParentRoute: () => Route$34
});
var ApiAuthSplatRoute = Route$4.update({
	id: "/api/auth/$",
	path: "/api/auth/$",
	getParentRoute: () => Route$34
});
var ApiV1HealthRoute = Route$3.update({
	id: "/api/v1/health",
	path: "/api/v1/health",
	getParentRoute: () => Route$34
});
var ApiV1CronBillingRoute = Route$2.update({
	id: "/api/v1/cron/billing",
	path: "/api/v1/cron/billing",
	getParentRoute: () => Route$34
});
var ApiWebhooksKopokopoSlugRoute = Route$1.update({
	id: "/api/webhooks/kopokopo/$slug",
	path: "/api/webhooks/kopokopo/$slug",
	getParentRoute: () => Route$34
});
var ApiWebhooksMpesaSlugRoute = Route.update({
	id: "/api/webhooks/mpesa/$slug",
	path: "/api/webhooks/mpesa/$slug",
	getParentRoute: () => Route$34
});
var AppRouteChildren = {
	AppAcsRoute,
	AppAiRoute,
	AppBillingRoute,
	AppCustomersRoute,
	AppFieldRoute,
	AppHotspotRoute,
	AppImportRoute,
	AppNotificationsRoute,
	AppPackagesRoute,
	AppPartnersRoute,
	AppRadiusRoute,
	AppReportsRoute,
	AppRoutersRoute,
	AppServicesRoute,
	AppSettingsRoute,
	AppStatementsRoute,
	AppTicketsRoute,
	AppIndexRoute
};
var AppRouteWithChildren = AppRoute._addFileChildren(AppRouteChildren);
var PortalRouteChildren = { PortalIndexRoute };
var PortalRouteWithChildren = PortalRoute._addFileChildren(PortalRouteChildren);
var ResellerRouteChildren = { ResellerIndexRoute };
var rootRouteChildren = {
	IndexRoute,
	AppRoute: AppRouteWithChildren,
	LoginRoute,
	PortalRoute: PortalRouteWithChildren,
	ResellerRoute: ResellerRoute._addFileChildren(ResellerRouteChildren),
	ApiAgentAckRoute,
	ApiAgentHeartbeatRoute,
	ApiAgentPullRoute,
	ApiAgentScriptRoute,
	ApiAuthSplatRoute,
	ApiV1HealthRoute,
	ApiV1CronBillingRoute,
	ApiWebhooksKopokopoSlugRoute,
	ApiWebhooksMpesaSlugRoute
};
var routeTree = Route$34._addFileChildren(rootRouteChildren)._addFileTypes();
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
function getRouter() {
	return createRouter({
		routeTree,
		defaultErrorComponent: AppErrorComponent
	});
}
//#endregion
export { createSsrRpc as n, router_exports as t };
