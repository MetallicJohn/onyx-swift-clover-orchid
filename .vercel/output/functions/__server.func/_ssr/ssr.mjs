import { r as __exportAll } from "../_runtime.mjs";
import { t as __exportAll$1 } from "./rolldown-runtime-D7D4PA-g.mjs";
import { A as resolveManifestAssetLink, C as require_jsx_runtime, H as isNotFound, L as isRedirect, M as _getRenderedMatches, N as executeRewriteInput, O as getScriptPreloadAttrs, P as invariant, R as isResolvedRedirect, U as require_react, V as rootRouteId, a as isSsrResponse, c as stripSsrResponseBody, i as disposeSsrResponseDetached, j as resolveManifestCssLink, k as getStylesheetHref, n as bindSsrResponseToRequest, o as normalizeSsrResponse, p as RouterProvider, r as defineHandlerCallback, s as replaceSsrResponse, t as renderRouterToStream, z as parseRedirect } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as createMemoryHistory } from "../_libs/tanstack__history.mjs";
import { a as getOrigin, c as createSerializationAdapter, d as toCrossJSONAsync, f as toCrossJSONStream, i as getNormalizedURL, l as makeSerovalPlugin, n as mergeHeaders, o as defaultSerovalPlugins, r as attachRouterServerSsrUtils, s as createRawStreamRPCPlugin, t as waitForRequest, u as fromJSON } from "../_libs/@tanstack/router-core+[...].mjs";
import { n as setCookie, r as toResponse, t as H3Event } from "../_libs/h3-v2+rou3.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
//#region node_modules/.nitro/vite/services/ssr/index.js
var ssr_exports = /* @__PURE__ */ __exportAll({
	a: () => getServerFnById,
	createServerEntry: () => createServerEntry,
	default: () => server_default,
	i: () => TSS_SERVER_FUNCTION,
	n: () => createMiddleware,
	o: () => getRequest,
	r: () => createServerFn,
	t: () => server_exports
});
require_react();
var import_jsx_runtime = require_jsx_runtime();
function StartServer(props) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RouterProvider, { router: props.router });
}
var defaultStreamHandler = defineHandlerCallback(({ request, router, responseHeaders }) => renderRouterToStream({
	request,
	router,
	responseHeaders,
	children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StartServer, { router })
}));
var GLOBAL_EVENT_STORAGE_KEY = Symbol.for("tanstack-start:event-storage");
var globalObj$1 = globalThis;
if (!globalObj$1[GLOBAL_EVENT_STORAGE_KEY]) globalObj$1[GLOBAL_EVENT_STORAGE_KEY] = new AsyncLocalStorage();
var eventStorage = globalObj$1[GLOBAL_EVENT_STORAGE_KEY];
function isPromiseLike(value) {
	return typeof value.then === "function";
}
function getSetCookieValues(headers) {
	const headersWithSetCookie = headers;
	if (typeof headersWithSetCookie.getSetCookie === "function") return headersWithSetCookie.getSetCookie();
	const value = headers.get("set-cookie");
	return value ? [value] : [];
}
function mergeEventResponseHeaders(response, event) {
	if (response.ok) return;
	const eventSetCookies = getSetCookieValues(event.res.headers);
	if (eventSetCookies.length === 0) return;
	const responseSetCookies = getSetCookieValues(response.headers);
	response.headers.delete("set-cookie");
	for (const cookie of responseSetCookies) response.headers.append("set-cookie", cookie);
	for (const cookie of eventSetCookies) response.headers.append("set-cookie", cookie);
}
function attachResponseHeaders(value, event) {
	if (isPromiseLike(value)) return value.then((resolved) => {
		if (resolved instanceof Response) mergeEventResponseHeaders(resolved, event);
		return resolved;
	});
	if (value instanceof Response) mergeEventResponseHeaders(value, event);
	return value;
}
function requestHandler(handler) {
	return (request, requestOpts) => {
		let h3Event;
		try {
			h3Event = new H3Event(request);
		} catch (error) {
			if (error instanceof URIError) return new Response(null, {
				status: 400,
				statusText: "Bad Request"
			});
			throw error;
		}
		return toResponse(attachResponseHeaders(eventStorage.run({ h3Event }, () => handler(request, requestOpts)), h3Event), h3Event);
	};
}
function getH3Event() {
	const event = eventStorage.getStore();
	if (!event) throw new Error(`No StartEvent found in AsyncLocalStorage. Make sure you are using the function within the server runtime.`);
	return event.h3Event;
}
function getRequest() {
	return getH3Event().req;
}
/**
* Set a cookie value by name.
* @param name Name of the cookie to set
* @param value Value of the cookie to set
* @param options {CookieSerializeOptions} Options for serializing the cookie
* ```ts
* setCookie('Authorization', '1234567')
* ```
*/
function setCookie$1(name, value, options) {
	setCookie(getH3Event(), name, value, options);
}
function getResponse() {
	return getH3Event().res;
}
var HEADERS = { TSS_SHELL: "X-TSS_SHELL" };
/**
* @description Returns the router manifest data that should be sent to the client.
* This includes only the assets and preloads for the current route and any
* special assets that are needed for the client. It does not include relationships
* between routes or any other data that is not needed for the client.
*
* @param matchedRoutes - In dev mode, the matched routes are used to build
* the dev styles URL for route-scoped CSS collection.
*/
async function getStartManifest(matchedRoutes) {
	const { tsrStartManifest } = await import("../_tanstack-start-manifest_v-BXU92o-8.mjs");
	const startManifest = tsrStartManifest();
	let routes = startManifest.routes;
	routes[rootRouteId];
	const manifestRoutes = {};
	for (const k in routes) {
		const v = routes[k];
		const result = {};
		if (v.preloads && v.preloads.length > 0) result.preloads = v.preloads;
		if (v.scripts && v.scripts.length > 0) result.scripts = v.scripts;
		if (v.css?.length) result.css = v.css;
		if (result.preloads || result.scripts || result.css) manifestRoutes[k] = result;
	}
	return {
		...startManifest.scriptFormat ? { scriptFormat: startManifest.scriptFormat } : {},
		...startManifest.inlineCss ? { inlineCss: startManifest.inlineCss } : {},
		routes: manifestRoutes
	};
}
var manifest = {
	"00bf21dfa438a7a234d2696308f9344ecc742c0f583b7794c81610533797fa19": {
		functionName: "adminResetPassword_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"01b10505a5114d752487e173a68294167cbf92c0333ce37812ae1a8187fcdd86": {
		functionName: "getVpsPublishGuide_createServerFn_handler",
		importer: () => import("./server-wg-j9SzbIgL.mjs")
	},
	"01d9a370f431d00b2239753d0892b99bdbb10ad8292c42b318acc1aa9b8ba698": {
		functionName: "listCustomerTagsFn_createServerFn_handler",
		importer: () => import("./server-tags-Dp5l-VIu.mjs")
	},
	"03a87dd3765c846fedf46e205b4458044cf97dcb6b78a0534a5138f8543601c0": {
		functionName: "listAgentQueue_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"0574a099e85b0ffe882dd02d0c85145cabf5dafcc9e3581213ecb1405412ffe1": {
		functionName: "updateNotificationTemplate_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"06a74cd76fa462be44603eee1b688c499626cd559aecb2d18fbe8dd56ed450b0": {
		functionName: "getMessaging_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"07b75a88f45b10d192a351b9566783c43f320ab2ab73613eb420e7225865135b": {
		functionName: "saveCommTemplateFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"07d199274f7a0f4d2adb69de171eabf357dabf7b05a4b0c5647c54d1de74eda0": {
		functionName: "getWireGuardHub_createServerFn_handler",
		importer: () => import("./server-wg-j9SzbIgL.mjs")
	},
	"0a472869a06c99550ab810f0d84ea8cc35b8d41f30b986e0ee9d2b0a4f307d87": {
		functionName: "previewAudienceFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"0a933c1d7147a260b0b7b06e923afe4666ce627387bcd37e42e1276b2128e23d": {
		functionName: "getPortalHome_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"0bc37d6d424ebf3c443e4599d12e084e9058555818c83cd9a48911368e57c8fb": {
		functionName: "listField_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"0bcaaa88f8609a2a4834646a21ece46a3ea013f80bfe9fb7d38534a9078a3894": {
		functionName: "getGracePolicyFn_createServerFn_handler",
		importer: () => import("./server-grace-D0mW_8rd.mjs")
	},
	"0d2293f0d5ccf188af86767aeda6af8e5de702551bf04a4f45d9dc9a982e8cf7": {
		functionName: "listSaasPlans_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"107df89607f4cf5642dd84e0b797075cd2a0d6ae8daf02cb91ea183e8afc75a8": {
		functionName: "setServiceStatus_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"11f261b5b46989587d024ed14c1f1b19a31fe8338874fb40001513738928feca": {
		functionName: "updateCustomer_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"12b85a6313c5bb5fdfb7fd198576b91ef8c22d631ed1411bad6f589f92f66d16": {
		functionName: "getSaasSettings_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"12b9094c5087afcc1d9bfae5c8dfdc7382133df3ef681bac797e668d052b8149": {
		functionName: "getKopokopo_createServerFn_handler",
		importer: () => import("./server-kopo-DWqDISOX.mjs")
	},
	"13ab33f1cc1d5e511d9e4a1b9aa78f476539680d32af0bd48396cc83e93d6534": {
		functionName: "copyRouterScript_createServerFn_handler",
		importer: () => import("./server-routers-C5zs00DK.mjs")
	},
	"17c9a3fe57a18486bd60f5036522922767e22f7d861f22899deb3a17576e1220": {
		functionName: "saveRouterApi_createServerFn_handler",
		importer: () => import("./server-mikrotik-BMrqV_Uz.mjs")
	},
	"1aa96ec1e6bb8d28e3a1127203556244a59201e1e6d6c20845d8c0b966bb1727": {
		functionName: "getPlatformOverview_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"1b6abb435e2aa24896e2c8e35bf8886c2482c692eee6e64c8d1403d9127b1f27": {
		functionName: "sendStk_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"1d4e3e192be8d5c8714b57ea331a50b7398bed8c05d73917dec5c22a2217341c": {
		functionName: "portalPasswordSignIn_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"1da6e3801cdc10c2df0cca6dc0e85b43356baa8aeef50bba4d00741b618b05c8": {
		functionName: "addRouter_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"1f485c1f5b2bfdd985970ac324a520b507ffc3a073eea03e8918423cd3353fae": {
		functionName: "getMyEntitlements_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"20b682a585126f1fdad57e194e964bf6cfd48cb577f54e4b24a1fa0aa73aa4aa": {
		functionName: "getSaasReports_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"21aa30200fbb871771a87c4ace21132b156363e6170f90c2c46f9c3c37e47d6a": {
		functionName: "recordPayment_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"22bcb5c3d5edf5875466ea542ef918f35683ee50e646baceb4461db13efc758c": {
		functionName: "changeMemberRole_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"26c8353ca79f76fb563d0536d2b86f0d98d4350ec88d24a776bc06e4ab6de54d": {
		functionName: "getSaasInfrastructure_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"275cc1578c2202d9318f729cbfca95f41d806544527a4cce8e6b21bce54d17d1": {
		functionName: "completePasswordReset_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"2b212a7204c4f24261e5a7c2e580746ee78f2d7b5d6ee6e1d9ee23611609ad88": {
		functionName: "portalChangePassword_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"2c34c4620cfd9f683aea8bfbfb5e7ec53c964195a6507cf296a2af20756424cf": {
		functionName: "verifyPortalLogin_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"2c4985e96c199268f7f639534cb5e8e31d6b19d43286bf77416413db60ffde26": {
		functionName: "fetchSessionUser_createServerFn_handler",
		importer: () => import("../__root-BHFDHNws.mjs")
	},
	"2c7d38a323f7060a64084bb37c50743b4eacce5a84b2ef1d83801a66ed1bae2f": {
		functionName: "getRouterApi_createServerFn_handler",
		importer: () => import("./server-mikrotik-BMrqV_Uz.mjs")
	},
	"3038cd6cc8f6f407e8479001e53c68728b0cc653d5648490041e1270e05909e0": {
		functionName: "listBilling_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"31ef43063c3a0dedbeef55e8bcd870df78e8ecd0560b492d6e861ae738d9101a": {
		functionName: "listHotspot_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"34b498d816e667b155a7a9c62e29651e293f074d3658c5c3135f6d3aedbc83b6": {
		functionName: "setCustomerTagsFn_createServerFn_handler",
		importer: () => import("./server-tags-Dp5l-VIu.mjs")
	},
	"3762011a8a863609d7f25b338b4d0962c3e62f545e3bb44f47ed98ae61a8e611": {
		functionName: "portalPay_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"37bd806d5240020f312999afc0775fa9092a66748917e0f191b6316f77becaa6": {
		functionName: "submitPublicInquiry_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"3825925e23a9dece455fd2f6bcc5f43649814004fa58a30552ba1bafb125c8c9": {
		functionName: "listRadius_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"3827f211bbd82335627e9c0710c0cf44850078235f38fff50f2902091fb86b86": {
		functionName: "previewRouterCommand_createServerFn_handler",
		importer: () => import("./server-mikrotik-BMrqV_Uz.mjs")
	},
	"3959b3d82909bb7d1001585144c237851b353f257c716ea0005a72f487ad5cb0": {
		functionName: "setCustomerPortalPassword_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"39d80ed4b6e680362a6b0ddb220628cd592bae56116a4bfe15c30944622089d0": {
		functionName: "platformStatus_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"3a6582f59dc2ac5b4363870f425d3af715f3ed79cb13247b2a0621e7c9702163": {
		functionName: "cancelSaasSubscription_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"3b65fa76427794bb9db6711fd25b659a0e5b0ecc27036dacb059f0d7a236dc44": {
		functionName: "linkReseller_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"3c65b46088be7203c998b3448a079188a6221248c6354fc379a276a05265dc4a": {
		functionName: "getPublicSite_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"3cd2cda27fc0b96acc2e818b8b8fa5942d8cdf01fcc5916eeaec565b1a53bcb2": {
		functionName: "queueRouterCommand_createServerFn_handler",
		importer: () => import("./server-mikrotik-BMrqV_Uz.mjs")
	},
	"3cf9a221aefd7efd12a061d772cafde5ec8fec397a3324f653e61c8e8a41d7b9": {
		functionName: "saveDocumentBranding_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"3e89b2607399ba88f8a16e73ff3cd6f647b1d0137deff4437ceafc701539493d": {
		functionName: "saveMessaging_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"40f0f06646f256fd88980085c17d1f2c6ba247dde6f33b71c9643a8fa5403ce2": {
		functionName: "getStatementPdf_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"434b7e52924a49ba3d2c02bf57e5bf1795c736f54b2d161bbd9ff232e34c4bea": {
		functionName: "getReports_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"43748ba334d00d3bda70f1cc4318063ad655e3305138033e08be98d5646c6246": {
		functionName: "revokeGraceFn_createServerFn_handler",
		importer: () => import("./server-grace-D0mW_8rd.mjs")
	},
	"44bdca23f66a1d52231da0da296d5040669368f258656441c934c0b8c374f172": {
		functionName: "listPublicPlans_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"466274032826f563db7ba08698de7091c5fc1c6bd8b44c3beed296fbe5da632c": {
		functionName: "updateSaasTenant_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"46b7725df2f9b6388c4819befb9a4adb94f3695115803b79e6888ecdc704e00a": {
		functionName: "getInvoicePdf_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"4705278a71002e45514d8b3e5552e20794aa2a7bfed773f93945781607fcadc2": {
		functionName: "enrollSaasNode_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"478f5a2cbe7fb162522f17a4b64a839c3d313854f8d22bf41c1209c001869e42": {
		functionName: "testKopokopo_createServerFn_handler",
		importer: () => import("./server-kopo-DWqDISOX.mjs")
	},
	"47c9a69fa5646be2202f8cd330078144d9fd12ba2afad8f737ed4331143ff9ca": {
		functionName: "createCustomerTagFn_createServerFn_handler",
		importer: () => import("./server-tags-Dp5l-VIu.mjs")
	},
	"488aeb1b613d5a353f9687b41c41eace61a8605b7d1d0269a9ce9d162b095b32": {
		functionName: "simulateAgentPull_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"48a0e790a8d1ae7d3d96adf83377a4c29339af9348cfbbe18dd818d8f19c6cd4": {
		functionName: "queueCpeTask_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"4cdcbc4d92e44f708c9ad19679788d00e050ec32d37b244e75e96e6be971c79b": {
		functionName: "importCustomers_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"4d0960c8a1c10db2929d477a1b3d252a733b4e4dc2bb7acb7ef6a1ed1495f026": {
		functionName: "getSaasActivity_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"4d32188543180f0a451d089415ae552aa21a70f71e011a089a5568013018bfa8": {
		functionName: "createVouchers_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"4f0b05ba56a0dcde26445f41ef827f51f0fa6dd880c08857a010fb893d90746b": {
		functionName: "getBranches_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"5139ec72ef7cd95594c293eae3021b86b86a3c91020bab91f8cdcf531ddefbb1": {
		functionName: "listRouters_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"549cf5839ef219b859689e0569f5ba00a24821a493894a81b3718668e8b92b31": {
		functionName: "rotateRadiusKey_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"585a675b300597194e639a29217ce1237b6a1d92315195c74e284f51754d3081": {
		functionName: "setCustomerTagEnabledFn_createServerFn_handler",
		importer: () => import("./server-tags-Dp5l-VIu.mjs")
	},
	"5df8987459be47db7012716158196d8446f4c78c9e37c54fe59ac95f96aa6213": {
		functionName: "savePublicBase_createServerFn_handler",
		importer: () => import("./server-mpesa-BlH3anSv.mjs")
	},
	"5e8272460fe47527feaf3e116670788a887c20b3c720f0d3244c5706512a7d73": {
		functionName: "downloadWireGuardServer_createServerFn_handler",
		importer: () => import("./server-wg-j9SzbIgL.mjs")
	},
	"5f38edbc2bb46f39fb882efe9ac573666125d8847ea7a0c2192872cd2a2facc5": {
		functionName: "resetSaasOperatorPassword_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"5f9cf45bb6f1e783c44c9b2bf8ae0c24895b7f5c3c9dd273d115216220cbbd59": {
		functionName: "listTicketStaff_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"62d491c28a0138cce95d6e2308a645a7f64ca6995edf437037e657745f604d3f": {
		functionName: "workspaceSlug_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"62f12a16c4a9fbb6f3114600ea27fcf4af4d5fa62aea2d9bab5e729f32e46b02": {
		functionName: "createPackage_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"634284e4631fc030e5d32c02aeb3cd4bc41fb897c028cade42cda34b823391d1": {
		functionName: "verifyResellerLogin_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"63f94eec1029d32e25fcb9dcc8b669a069d656e663f6888e5ee4528293b5a740": {
		functionName: "getSaasTenant_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"65ffed348c746e4fa38b133584e47a6a978e2f30a88da4619948de0699a612ed": {
		functionName: "setPlan_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"6934b4ca91cc2a9df76718145023a97502e058c976a53e9c4c4bbf2bf3905911": {
		functionName: "tickCampaignFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"693fd802704e726683002a77e5c7d01d54fcd47f4b02a0094f28d5248b95924e": {
		functionName: "listAcs_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"6a88e38a76ab45f9b3bd545076de5dca7a1c8e894e5cf2c824a687763893288a": {
		functionName: "createInvoice_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"6c7d7212bcb5ca68a8dd5917efe87c2ce00d848cd2d14c1cba14a35009e624fa": {
		functionName: "bulkCustomerTagsFn_createServerFn_handler",
		importer: () => import("./server-tags-Dp5l-VIu.mjs")
	},
	"6c9de35413d7ffde4b62bd9492dac623db9bced2fd387a87d98d1a58cd58e1b2": {
		functionName: "disconnectRadius_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"6cc57261e98985e29d9ad06b62b90ee399d17f030af756dabfcb1fc62758ae07": {
		functionName: "commentOpenTicket_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"6dc3a12f614ad2143321f5f24d068bfc75df5f073d111dea1f2d907e95cc4c4f": {
		functionName: "listServices_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"6ecd7131ef3df227430d4eed137b040c45cb60979ffa69576cec6be20fdcf378": {
		functionName: "setSaasPlanStatus_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"6f2dd74b052e6f8336d93164fe33861ba862bd9242ed87cd93d4a50e8f0817de": {
		functionName: "deleteCustomerTagFn_createServerFn_handler",
		importer: () => import("./server-tags-Dp5l-VIu.mjs")
	},
	"7333f74816133aef0c5a756e38329e0b8ebbd9bf77e991cdefd304a698570ff3": {
		functionName: "createCustomer_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"7478a129405d9c349b39946b965b6155d28251cb47ec72c6da88570730a1dbab": {
		functionName: "requestPasswordReset_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"749688580f75f39a1f55afbaa68dcfef33818711f3bc3c826843a7ef13c0955b": {
		functionName: "suspendSaasTenant_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"78778dc6f040cb781915956ffc448402fb71db00bbedd78e601ef7e78e6d1540": {
		functionName: "recordPlanPayment_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"7a3ed4d70dd42c8971f07ea7d475b02f46118d1ca553da1a080f150da6061b47": {
		functionName: "sendPlanStk_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"7c0bf9bf3e07600e39acb97104366144d1ad6877b8c0305f174fe324a8913e2d": {
		functionName: "endSaasSupport_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"8189f346456057568a37dde47fdf2a26d0c291ad3b07ca011b3e642c4eddade6": {
		functionName: "assignOpenTicket_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"830e682f10512ee2eee1cd75d71f0db022bb8c479fea20858c2e35a1f11eb0d9": {
		functionName: "createTicket_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"88ab3927a37c1a5fb45d409fb855f48ce6963999678eb1a80ed60a8639a99c99": {
		functionName: "updateRouter_createServerFn_handler",
		importer: () => import("./server-routers-C5zs00DK.mjs")
	},
	"8929e8e5986deeb9ce8e7ffa5893daae647c195cd73a4c594d7ce92cb7b58654": {
		functionName: "listMyTenants_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"8b3476929d1049c30cbfbf66421622361c24fba683ee2d4893beada42f811bb8": {
		functionName: "saveTenantThemeFn_createServerFn_handler",
		importer: () => import("./server-theme-DIqUORu8.mjs")
	},
	"8b44fd85d5a9faba91b802ea8f5d3e0211c9b7620c10325617c1d0584c69dd7f": {
		functionName: "assignSaasPlan_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"8b4d75d7aba47cd27a00f58c573ce78a823995059b5125b8bb3f8ed090004280": {
		functionName: "resendFailedFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"8bf82b607ed5461071bd9fc9539e6c819010bc8ba4f354f81dafc9ea489868b4": {
		functionName: "listSaasTenants_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"8c453e30ee61eff4202a8239eb1e3ae5af09315d29765a50dc8a0a74d2c29223": {
		functionName: "reactivateSaasTenant_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"8ca589381c089c0ceaafbba885034c9c61b9ac8a4d424584d0d66cedc1b27350": {
		functionName: "saveSaasSettings_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"8d55894f738b772309598ee421788e6709822a98ada9e6b61d10f94c10eb3753": {
		functionName: "toggleProvider_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"8e1392816efb0d87ed30324df30d5fde33bbb12011442e0e1c4bc495f53c00c3": {
		functionName: "getPlan_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"8f352dc5bd73dc8380f4c67d0a244450949973a3c457bf418e8ca70182166d71": {
		functionName: "saveAcsSettings_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"913200ff77f29304ee30fd95bdce91cf50202f8ad6a7cffc52bff073a94e9f25": {
		functionName: "saveMpesa_createServerFn_handler",
		importer: () => import("./server-mpesa-BlH3anSv.mjs")
	},
	"9164e3f538383b8feb6ada8e62c05f8dda9ca99b5ca51c9e1027f887df58ecc4": {
		functionName: "getIncomingPayments_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"927c7845d2692853774f93db8a0bf205fde11794f72073a81ed2f971cc41d4dd": {
		functionName: "renameTenant_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"92a4ab570feb67e233c0d3a749a2570aa9516889cff59783e912dfd5123d559f": {
		functionName: "addSaasOperator_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"9384cbd43c0092f493f0f09852f99743b9dda1ec498cfa6ae2ae273dc35f6502": {
		functionName: "saveGracePolicyFn_createServerFn_handler",
		importer: () => import("./server-grace-D0mW_8rd.mjs")
	},
	"965ce366b708fde96a80534dbee18bc88bc149c4ec6d7110e492239285aa31ec": {
		functionName: "listCommTemplatesFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"96acc94f456a915586d54310f214eae9040f47bacbd19137ab0f191ebc3cf969": {
		functionName: "startSaasSupport_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"96c696639b4e84c81207205c3437928944646a07d66a6800eca5f5ee5fd7357b": {
		functionName: "emailStatementPdf_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"98e4e95f7fa179bd1267b242d5ca25fc1dc568a316603db027f0487f48e8234e": {
		functionName: "getStatementDocument_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"990333dbf23e6550cd986e3e5ef073cf9327280beb4569e280874e04d7d58e91": {
		functionName: "getMpesa_createServerFn_handler",
		importer: () => import("./server-mpesa-BlH3anSv.mjs")
	},
	"9cb7069991d792125d9fa6cef27b8221211dbe1658c23ed02fdcaff14e11d073": {
		functionName: "listNotifications_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"9d426eff2ff340d394f431246126a7911921d3542f06a4e3e3574368df9163f4": {
		functionName: "grantGraceFn_createServerFn_handler",
		importer: () => import("./server-grace-D0mW_8rd.mjs")
	},
	"9dee39d4fd2d27ce30ac377dc62a55edac44617b8da966df91c157c853d4ba6a": {
		functionName: "rotateServiceSecret_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"9f22ac761f3885e9157652a1b6472e6e6ae76548e42fc0a8ea03e999587dd762": {
		functionName: "exportCustomersCsv_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"a20611a7f7f3bdaa247dc1fe23e47513ec20777296774808872163e80ea17713": {
		functionName: "requestPortalOtp_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"a3b90f4522ea74aaf3263ed50e2e6e64308ecb25ee1b8deaf507f4eedcdc888e": {
		functionName: "emailInvoicePdf_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"a4276df6051847507687b2c60b80786fcb29007a418aed8bf97a7793326fe460": {
		functionName: "listCpeTasks_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"a4d733d35c608e1b64ef6e2c584e63ca7865697e316a6be9e7cd0ac8805ed393": {
		functionName: "listCampaignsFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"a51779c6cac87f3eab85b8d9d511f5d1e76dbc9fbe42ae946556d155deadaf4e": {
		functionName: "runAutomatedBilling_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"a634b9e860990cf06fea3c0534afc623dcd29ed4717195c19fefd71202f90797": {
		functionName: "exportRadiusUsers_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"a76066a1f6300a7123c531d2650d60ffef5733ded90f846ea2670ac6e693f0e0": {
		functionName: "assignPaybillPayments_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"ad3b59d344956234e702d3c96c30ffd11ca87a555f01cee906ead15a555a80d2": {
		functionName: "activateHotspotVoucher_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"b133c9d2281c87a19ad4dc4fdb2adec6ab8dbd3bafc4069c469dabddaf08a1a1": {
		functionName: "getCampaignFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"b4dcbf82b4bf84ba2b6f2bd159223569688d730940310a7318b304e4a5b4078e": {
		functionName: "checkSmsAccount_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"b582b0375ef59646fde49b719190b2c5a99f39a58ec87faf15a70c06f69b7316": {
		functionName: "broadcastCustomersFn_createServerFn_handler",
		importer: () => import("./server-tags-Dp5l-VIu.mjs")
	},
	"b593c1668ada7a7d3fd992a0b9822fac074f0bb798281a59787551829e429531": {
		functionName: "extendGraceFn_createServerFn_handler",
		importer: () => import("./server-grace-D0mW_8rd.mjs")
	},
	"b7d818503ab327c5550cf5a44adc05a588eee3aae1556873826b617075df126d": {
		functionName: "getCommsMetaFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"b82b9e563917b8ca5c159855fbc036e93fae3ccf99f0f58fdfb124f9e0633d05": {
		functionName: "bootstrapWorkspace_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"b82f6c5d4d7c9cda154c3316f0754d633de311765d8ba3edde7e8c2deb0f5ba9": {
		functionName: "confirmStk_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"b8cdd856e4723bd8691e891996a289b24615758ae420af7b40146abda15964ac": {
		functionName: "askRouterOs_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"b923f07b4b4fa0d4e93188fd249a30703fef1cedc4b3e0d414bf7ce756503493": {
		functionName: "disconnectService_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"b9e2f864ed9e659f04e84c867dfddaaa943b0067a7bb328f27e2557d6158d00c": {
		functionName: "informCpe_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"ba96a44f28cb314113fd2de99355278a9e4682505f11c38fb1fbe6d5e019b2b2": {
		functionName: "approveRouterCommand_createServerFn_handler",
		importer: () => import("./server-mikrotik-BMrqV_Uz.mjs")
	},
	"bcb442d75d8d4c0de9feb0b2de64ac86f75fc24881de015b22754c94211bdf86": {
		functionName: "createStaffAccount_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"bcbc4de96ff7eb6982474e24253af7c422b2f107db5561a7c3ef874b31a402ec": {
		functionName: "saveWireGuardHub_createServerFn_handler",
		importer: () => import("./server-wg-j9SzbIgL.mjs")
	},
	"c037d1381ac27bd2e0c81c325fe731f04b1579979eef42077962c0a961b4ae53": {
		functionName: "portalInvoicePdf_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"c10d454b7b316764260bb4a2596617dcd331001d92da03657cf912069f30bc71": {
		functionName: "syncAcsFromNbi_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"c1520bcc010bb4ebf1d67f2a10bcb57a56664034ab50a2c439c081e57d5b658b": {
		functionName: "addReferral_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"c1f8f6abd400cff69c71744e2921567e8c2f3b9709fbd9168556069264c948e0": {
		functionName: "getStatement_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"c31edd8c55cd710d0891392a0052d0e316abb9ad7cd02307b2d748d2ec212580": {
		functionName: "requestResellerOtp_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"c8c89d4b52f204e1aa3c069694f76ae89143c716f7213999748c3c2ce819ba1d": {
		functionName: "runRouterApi_createServerFn_handler",
		importer: () => import("./server-mikrotik-BMrqV_Uz.mjs")
	},
	"cb0a572eb9356911f9f3e76366206dc0242d0bce25cc9dd2ed0a14acbe0a95dd": {
		functionName: "getDashboard_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"cb742ca04824157339969c950edad77bd51c50934e44112a1ef506e8e8caf911": {
		functionName: "listSaasSubscriptions_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"cedb1c0654f1ec316cc9c7488219b88a706c691918e199b938f3351a5ec204cb": {
		functionName: "extendSaasTrial_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"cf13f985b8dcd8e22d8bffb584d5c71a1ed93fbac8b1f1faf4380bee306d84b9": {
		functionName: "renameCustomerTagFn_createServerFn_handler",
		importer: () => import("./server-tags-Dp5l-VIu.mjs")
	},
	"d09c5cf0bf37e8391b2e939a9da6fc5488a8a8f5ee95ff5358d12dda9b9c4b4c": {
		functionName: "getInvoiceDocument_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"d10de407eff592c85952061661ba87d1fba7422d507030cb442c829f990cc222": {
		functionName: "saveBillingSettings_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"d235537725464ec7faf2e44a6c286c946a553ab15aea762cb670d66b94dfb3d1": {
		functionName: "changeMyPassword_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"d26c18f5e005678a0a92ba783fbea70f752a7d5e40a31c68987737d4c79f78b0": {
		functionName: "getPublicBranding_createServerFn_handler",
		importer: () => import("./server-theme-DIqUORu8.mjs")
	},
	"d28e5ebec9ec7ee946a0ba9e0ebdca5794d4920752440d50b25a4e5af069f34a": {
		functionName: "exportSaasReportsCsv_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"d29992f7e813ce2a2df10e18aa1531c7a7662ea27648ba573b424d6e6a12e10a": {
		functionName: "getInvoice_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"d42debbe35d08a84f809c102bc9a795caba9b10c809e89a8a0bae236b375c870": {
		functionName: "listPartners_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"d45375937a6888331a2306c32a65db49eb516ff9ff1742f9490cd03f9489c598": {
		functionName: "deleteCommTemplateFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"d6f465a9cb00252e75b84dd823dca040faee861feaa400efdeb65dcbca570c78": {
		functionName: "setStaffPassword_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"d923b150a75c2fff8dd70439e7a139eee5367b02afd83b2fba16911c2b01c39f": {
		functionName: "sendCampaignFn_createServerFn_handler",
		importer: () => import("./server-comms-Lnp4aTHM.mjs")
	},
	"d9ccbd4f5a0898071d3ab80984bcb61c7b2a00b209d5be98fb6e08e98e1e05df": {
		functionName: "listPlatformTenants_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"d9d3c88c37b6987ccdc28add8b12626a91aa49ac24954d749898588ad38cfc0b": {
		functionName: "listCustomers_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"dc6c00b3a1df2860e149b926675af6275a2500ba3e242177ae1e5dd559aa1f44": {
		functionName: "portalOpenTicket_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"dca568a5575de21b69b2e844fe3531e89215694ffcbf914e4655369e397cbba6": {
		functionName: "addCpe_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"dcb1b21a6e1d2194348428c3ff84b387445c4cbaad2e52add04ef0966a3991a3": {
		functionName: "getDocumentBranding_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"dd13d2bc9f9bcb42f78a7414db6e05fe055853339d21cd5d811c699534789059": {
		functionName: "rotateWireGuardHub_createServerFn_handler",
		importer: () => import("./server-wg-j9SzbIgL.mjs")
	},
	"dd66a2f2e88a97fde4c7bc456d49abbf04aebacbae551f33b6db26c17eeab899": {
		functionName: "getAuditLog_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"ded815bbda8adc79c3ceb83c0ecdf6eadc523be27d0d534096e955d906731122": {
		functionName: "portalRequestGrace_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"e2fe93fbeec90c7b90207fcb5f255ccbf30aae4915fe179d00bddd42186899e8": {
		functionName: "createBranch_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"e47f313db27528c49b039deed2d49908a05112b3224ec28d138b2af87ebf5c1f": {
		functionName: "createSaasTenant_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"e65599353cff8378ba7f5c98cc7f095dcb460665b9867c90c662fc9e2bea655d": {
		functionName: "getPlatformGate_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"e761a3d9f77c10bf3a83db411f3f4bd2bca663f2dc6062e7cc9d479dbd070250": {
		functionName: "completePortalPasswordResetFn_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"e78843982652677c66d853dedd123a6a16bf73e7398cde1a3c81a6f0678c1e37": {
		functionName: "listPackages_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"e7e284ff2420e2291330090fd2754623ea0c40c1b4ceffcaf98716e174a022f2": {
		functionName: "createIspAsAdmin_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"e8aa2836b3a89aeb7cd471b7107b01b460c43f28c428d4a29f1af48041c826ae": {
		functionName: "listProviders_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"e9fea7d3fb26d0ce3ed0ab5c1b326b94f06fb029464099c575e71aa5434682e1": {
		functionName: "getResellerHome_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"ea6691fb42982b9ab59590a4bd3913dbd6e207bc04e494e931d021f2fb5f65fc": {
		functionName: "revokeHotspotVoucher_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"eca8eea30ac0436609c1dbe175fdc0164ab0dca2185b68f9ab65994386cc791c": {
		functionName: "addReseller_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"ef583255205c89735dd158fd64bc064a009a8614456fb7ce4c3e37ba94355fc2": {
		functionName: "searchSaas_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"f075398e94e2bd2fb3b94ced67a1ef8694a805d176a93f1385c1909df18a6d50": {
		functionName: "testMessaging_createServerFn_handler",
		importer: () => import("./server-ops-D4klcitd.mjs")
	},
	"f0d807a698d32edcb199283a08d28db6460e51f1ebcb7800b41f38cae22eb518": {
		functionName: "testMpesa_createServerFn_handler",
		importer: () => import("./server-mpesa-BlH3anSv.mjs")
	},
	"f191e0976790b49a0f7b7d9c0bb41868d24dacf683d4bbea75bdf81b4568538a": {
		functionName: "redeemPoints_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"f1f826d101b04a91c5fdd2e35199b7539cd86e4c622bfa16db8d9ab3470a43b3": {
		functionName: "getSaasRevenue_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	},
	"f23584ea5f35348bbc5dd5ff7a16f82a0903084ccd9f2b228374fd11b020e7bd": {
		functionName: "getTenantTheme_createServerFn_handler",
		importer: () => import("./server-theme-DIqUORu8.mjs")
	},
	"f343a29b60bea3cb975580feb1062e80abbf518b4cb5c670f5ade0de000536ba": {
		functionName: "inviteMember_createServerFn_handler",
		importer: () => import("./server-more-DKklYTXH.mjs")
	},
	"f8152056cc910d521a7b215c86a67025896f3f669f7546d227d9af72f86ff250": {
		functionName: "updatePackage_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"f953d0c914d0090460292b04ae97b9a85879f43955ccd44d3aa35bec7b7b9b4c": {
		functionName: "switchTenant_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"f9b3f332043676708e8c1ab892b6e537af272e6db59123681b5b45ef00a5250a": {
		functionName: "saveKopokopo_createServerFn_handler",
		importer: () => import("./server-kopo-DWqDISOX.mjs")
	},
	"f9f4f5cc635047ddc6b6f5a986c941472688c45a108340df6f8c5cba87355c52": {
		functionName: "setTicketStatus_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"fb8f4084dd5b89df9ed7de4fee9d7846f044eceed9cafadec3e9fc9138dc4d5e": {
		functionName: "createService_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"fbbe28f960b118c4ac3fcbc69927b1048dd832e6275e0258b170198c07a264bf": {
		functionName: "listTickets_createServerFn_handler",
		importer: () => import("./server-B981gDhT.mjs")
	},
	"feb832028bcb2b49efe4ef8ccb162a315a0f144ff2e315b285217f114c8cba2c": {
		functionName: "portalStatementPdf_createServerFn_handler",
		importer: () => import("./server-docs-BRUsLCsO.mjs")
	},
	"ff64478e9389fd6817783c965aa21c9a83ab8ae142f068dd442151bd4717af8e": {
		functionName: "saveSaasPlan_createServerFn_handler",
		importer: () => import("./server-platform-B1GBzjKL.mjs")
	}
};
async function getServerFnById(id, access) {
	const serverFnInfo = manifest[id];
	if (!serverFnInfo) throw new Error("Server function info not found for " + id);
	const fnModule = serverFnInfo.module ?? await serverFnInfo.importer();
	if (!fnModule) throw new Error("Server function module not resolved for " + id);
	const action = fnModule[serverFnInfo.functionName];
	if (!action) throw new Error("Server function module export not resolved for serverFn ID: " + id);
	return action;
}
var TSS_FORMDATA_CONTEXT = "__TSS_CONTEXT";
var TSS_SERVER_FUNCTION = Symbol.for("TSS_SERVER_FUNCTION");
var TSS_SERVER_FUNCTION_FACTORY = Symbol.for("TSS_SERVER_FUNCTION_FACTORY");
var X_TSS_SERIALIZED = "x-tss-serialized";
var X_TSS_RAW_RESPONSE = "x-tss-raw";
/** Content-Type for multiplexed framed responses (RawStream support) */
var TSS_CONTENT_TYPE_FRAMED = "application/x-tss-framed";
/**
* Frame types for binary multiplexing protocol.
*/
var FrameType = {
	/** Seroval JSON chunk (NDJSON line) */
	JSON: 0,
	/** Raw stream data chunk */
	CHUNK: 1,
	/** Raw stream end (EOF) */
	END: 2,
	/** Raw stream error */
	ERROR: 3
};
/** Full Content-Type header value with version parameter */
var TSS_CONTENT_TYPE_FRAMED_VERSIONED = `${TSS_CONTENT_TYPE_FRAMED}; v=1`;
function isSafeKey(key) {
	return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}
/**
* Merge target and source into a new null-proto object, filtering dangerous keys.
*/
function safeObjectMerge(target, source) {
	const result = Object.create(null);
	if (target) {
		for (const key of Object.keys(target)) if (isSafeKey(key)) result[key] = target[key];
	}
	if (source && typeof source === "object") {
		for (const key of Object.keys(source)) if (isSafeKey(key)) result[key] = source[key];
	}
	return result;
}
/**
* Create a null-prototype object, optionally copying from source.
*/
function createNullProtoObject(source) {
	if (!source) return Object.create(null);
	const obj = Object.create(null);
	for (const key of Object.keys(source)) if (isSafeKey(key)) obj[key] = source[key];
	return obj;
}
var GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context");
var globalObj = globalThis;
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage();
var startStorage = globalObj[GLOBAL_STORAGE_KEY];
async function runWithStartContext(context, fn) {
	return startStorage.run(context, fn);
}
function getStartContext(opts) {
	const context = startStorage.getStore();
	if (!context && opts?.throwIfNotFound !== false) throw new Error(`No Start context found in AsyncLocalStorage. Make sure you are using the function within the server runtime.`);
	return context;
}
var getStartOptions = () => getStartContext().startOptions;
var getStartContextServerOnly = getStartContext;
var createServerFn = (options, __opts) => {
	const resolvedOptions = __opts || options || {};
	if (typeof resolvedOptions.method === "undefined") resolvedOptions.method = "GET";
	const setValidator = (validator) => {
		return createServerFn(void 0, {
			...resolvedOptions,
			validator,
			inputValidator: validator
		});
	};
	const res = {
		options: resolvedOptions,
		middleware: (middleware) => {
			const newMiddleware = [...resolvedOptions.middleware || []];
			middleware.map((m) => {
				if (TSS_SERVER_FUNCTION_FACTORY in m) {
					if (m.options.middleware) newMiddleware.push(...m.options.middleware);
				} else newMiddleware.push(m);
			});
			const res = createServerFn(void 0, {
				...resolvedOptions,
				middleware: newMiddleware
			});
			res[TSS_SERVER_FUNCTION_FACTORY] = true;
			return res;
		},
		validator: setValidator,
		inputValidator: setValidator,
		handler: (...args) => {
			const [extractedFn, serverFn] = args;
			const newOptions = {
				...resolvedOptions,
				extractedFn,
				serverFn
			};
			const resolvedMiddleware = [...newOptions.middleware || [], serverFnBaseToMiddleware(newOptions)];
			extractedFn.method = resolvedOptions.method;
			return Object.assign(async (opts) => {
				const result = await executeMiddleware$1(resolvedMiddleware, "client", {
					...extractedFn,
					...newOptions,
					data: opts?.data,
					headers: opts?.headers,
					signal: opts?.signal,
					fetch: opts?.fetch,
					context: createNullProtoObject()
				});
				const redirect = parseRedirect(result.error);
				if (redirect) throw redirect;
				if (result.error) throw result.error;
				return result.result;
			}, {
				...extractedFn,
				method: resolvedOptions.method,
				__executeServer: async (opts) => {
					const startContext = getStartContextServerOnly();
					const serverContextAfterGlobalMiddlewares = startContext.contextAfterGlobalMiddlewares;
					return await executeMiddleware$1(resolvedMiddleware, "server", {
						...extractedFn,
						...opts,
						serverFnMeta: extractedFn.serverFnMeta,
						context: safeObjectMerge(opts.context, serverContextAfterGlobalMiddlewares),
						request: startContext.request
					}).then((d) => ({
						result: d.result,
						error: d.error,
						context: d.sendContext
					}));
				}
			});
		}
	};
	const fun = (options) => {
		return createServerFn(void 0, {
			...resolvedOptions,
			...options
		});
	};
	return Object.assign(fun, res);
};
async function executeMiddleware$1(middlewares, env, opts) {
	let flattenedMiddlewares = flattenMiddlewares([...getStartOptions()?.functionMiddleware || [], ...middlewares]);
	if (env === "server") {
		const startContext = getStartContextServerOnly({ throwIfNotFound: false });
		if (startContext?.executedRequestMiddlewares) flattenedMiddlewares = flattenedMiddlewares.filter((m) => !startContext.executedRequestMiddlewares.has(m));
	}
	const callNextMiddleware = async (ctx) => {
		const nextMiddleware = flattenedMiddlewares.shift();
		if (!nextMiddleware) return ctx;
		try {
			let validator = "validator" in nextMiddleware.options ? nextMiddleware.options.validator : void 0;
			if (!validator && "inputValidator" in nextMiddleware.options) validator = nextMiddleware.options.inputValidator;
			if (validator && env === "server") ctx.data = await execValidator(validator, ctx.data);
			let middlewareFn = void 0;
			if (env === "client") {
				if ("client" in nextMiddleware.options) middlewareFn = nextMiddleware.options.client;
			} else if ("server" in nextMiddleware.options) middlewareFn = nextMiddleware.options.server;
			if (middlewareFn) {
				const userNext = async (userCtx = {}) => {
					const result = await callNextMiddleware({
						...ctx,
						...userCtx,
						context: safeObjectMerge(ctx.context, userCtx.context),
						sendContext: safeObjectMerge(ctx.sendContext, userCtx.sendContext),
						headers: mergeHeaders(ctx.headers, userCtx.headers),
						_callSiteFetch: ctx._callSiteFetch,
						fetch: ctx._callSiteFetch ?? userCtx.fetch ?? ctx.fetch,
						result: userCtx.result !== void 0 ? userCtx.result : userCtx instanceof Response ? userCtx : ctx.result,
						error: userCtx.error ?? ctx.error
					});
					if (result.error) throw result.error;
					return result;
				};
				const result = await middlewareFn({
					...ctx,
					next: userNext
				});
				if (isRedirect(result)) return {
					...ctx,
					error: result
				};
				if (result instanceof Response) return {
					...ctx,
					result
				};
				if (!result) throw new Error("User middleware returned undefined. You must call next() or return a result in your middlewares.");
				return result;
			}
			return callNextMiddleware(ctx);
		} catch (error) {
			return {
				...ctx,
				error
			};
		}
	};
	return callNextMiddleware({
		...opts,
		headers: opts.headers || {},
		sendContext: opts.sendContext || {},
		context: opts.context || createNullProtoObject(),
		_callSiteFetch: opts.fetch
	});
}
function flattenMiddlewares(middlewares, maxDepth = 100) {
	const seen = /* @__PURE__ */ new Set();
	const flattened = [];
	const recurse = (middleware, depth) => {
		if (depth > maxDepth) throw new Error(`Middleware nesting depth exceeded maximum of ${maxDepth}. Check for circular references.`);
		middleware.forEach((m) => {
			if (m.options.middleware) recurse(m.options.middleware, depth + 1);
			if (!seen.has(m)) {
				seen.add(m);
				flattened.push(m);
			}
		});
	};
	recurse(middlewares, 0);
	return flattened;
}
async function execValidator(validator, input) {
	if (validator == null) return {};
	if ("~standard" in validator) {
		const result = await validator["~standard"].validate(input);
		if (result.issues) throw new Error(JSON.stringify(result.issues, void 0, 2));
		return result.value;
	}
	if ("parse" in validator) return validator.parse(input);
	if (typeof validator === "function") return validator(input);
	throw new Error("Invalid validator type!");
}
function serverFnBaseToMiddleware(options) {
	return {
		"~types": void 0,
		options: {
			inputValidator: options.validator ?? options.inputValidator,
			client: async ({ next, sendContext, fetch, ...ctx }) => {
				const payload = {
					...ctx,
					context: sendContext,
					fetch
				};
				return next(await options.extractedFn?.(payload));
			},
			server: async ({ next, ...ctx }) => {
				const result = await options.serverFn?.(ctx);
				return next({
					...ctx,
					result
				});
			}
		}
	};
}
var createMiddleware = (options, __opts) => {
	const resolvedOptions = {
		type: "request",
		...__opts || options
	};
	const setValidator = (validator) => {
		return createMiddleware({}, Object.assign(resolvedOptions, {
			validator,
			inputValidator: validator
		}));
	};
	return {
		options: resolvedOptions,
		middleware: (middleware) => {
			return createMiddleware({}, Object.assign(resolvedOptions, { middleware }));
		},
		validator: setValidator,
		inputValidator: setValidator,
		client: (client) => {
			return createMiddleware({}, Object.assign(resolvedOptions, { client }));
		},
		server: (server) => {
			return createMiddleware({}, Object.assign(resolvedOptions, { server }));
		}
	};
};
var innerCreateCsrfMiddleware = (opts = {}) => {
	return createMiddleware().server(async (ctx) => {
		const csrfCtx = ctx;
		if (opts.filter && !await opts.filter(csrfCtx)) return ctx.next();
		if (await isCsrfRequestAllowed(opts, csrfCtx)) return ctx.next();
		return getFailureResponse(opts, csrfCtx);
	});
};
var createCsrfMiddleware = innerCreateCsrfMiddleware;
async function isCsrfRequestAllowed(opts, ctx) {
	const result = await getCsrfRequestValidationResult(opts, ctx);
	return result === true || result === void 0 && opts.allowRequestsWithoutOriginCheck === true;
}
async function getCsrfRequestValidationResult(opts, ctx) {
	const fetchSite = ctx.request.headers.get("Sec-Fetch-Site");
	if (fetchSite !== null) return matchValue(opts.secFetchSite ?? "same-origin", fetchSite, ctx);
	const origin = ctx.request.headers.get("Origin");
	if (origin !== null) {
		if (opts.origin) return matchValue(opts.origin, origin, ctx);
		return origin === new URL(ctx.request.url).origin;
	}
	const referer = ctx.request.headers.get("Referer");
	if (referer === null || opts.referer === false) return;
	if (typeof opts.referer === "function") return opts.referer(referer, ctx);
	if (opts.origin) {
		const refererOrigin = getOriginFromUrl(referer);
		return refererOrigin !== void 0 && matchValue(opts.origin, refererOrigin, ctx);
	}
	return isRefererSameOrigin(referer, new URL(ctx.request.url).origin);
}
async function matchValue(matcher, value, ctx) {
	if (typeof matcher === "function") return matcher(value, ctx);
	if (Array.isArray(matcher)) return matcher.includes(value);
	return value === matcher;
}
function getOriginFromUrl(url) {
	try {
		return new URL(url).origin;
	} catch {
		return;
	}
}
function isRefererSameOrigin(referer, requestOrigin) {
	if (referer === requestOrigin) return true;
	if (!referer.startsWith(requestOrigin)) return false;
	if (referer.length === requestOrigin.length) return true;
	const code = referer.charCodeAt(requestOrigin.length);
	return code === 47 || code === 63 || code === 35;
}
async function getFailureResponse(opts, ctx) {
	if (typeof opts.failureResponse === "function") return opts.failureResponse(ctx);
	return opts.failureResponse?.clone() ?? new Response("Forbidden", { status: 403 });
}
function getDefaultSerovalPlugins() {
	return [...(getStartOptions()?.serializationAdapters)?.map(makeSerovalPlugin) ?? [], ...defaultSerovalPlugins];
}
/**
* Binary frame protocol for multiplexing JSON and raw streams over HTTP.
*
* Frame format: [type:1][streamId:4][length:4][payload:length]
* - type: 1 byte - frame type (JSON, CHUNK, END, ERROR)
* - streamId: 4 bytes big-endian uint32 - stream identifier
* - length: 4 bytes big-endian uint32 - payload length
* - payload: variable length bytes
*/
/** Cached TextEncoder for frame encoding */
var textEncoder = new TextEncoder();
/** Shared empty payload for END frames - avoids allocation per call */
var EMPTY_PAYLOAD = /* @__PURE__ */ new Uint8Array(0);
/**
* Encodes a single frame with header and payload.
*/
function encodeFrame(type, streamId, payload) {
	const frame = new Uint8Array(9 + payload.length);
	frame[0] = type;
	frame[1] = streamId >>> 24 & 255;
	frame[2] = streamId >>> 16 & 255;
	frame[3] = streamId >>> 8 & 255;
	frame[4] = streamId & 255;
	frame[5] = payload.length >>> 24 & 255;
	frame[6] = payload.length >>> 16 & 255;
	frame[7] = payload.length >>> 8 & 255;
	frame[8] = payload.length & 255;
	frame.set(payload, 9);
	return frame;
}
/**
* Encodes a JSON frame (type 0, streamId 0).
*/
function encodeJSONFrame(json) {
	return encodeFrame(FrameType.JSON, 0, textEncoder.encode(json));
}
/**
* Encodes a raw stream chunk frame.
*/
function encodeChunkFrame(streamId, chunk) {
	return encodeFrame(FrameType.CHUNK, streamId, chunk);
}
/**
* Encodes a raw stream end frame.
*/
function encodeEndFrame(streamId) {
	return encodeFrame(FrameType.END, streamId, EMPTY_PAYLOAD);
}
/**
* Encodes a raw stream error frame.
*/
function encodeErrorFrame(streamId, error) {
	const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
	return encodeFrame(FrameType.ERROR, streamId, textEncoder.encode(message));
}
/**
* Creates a multiplexed ReadableStream from JSON stream and raw streams.
*
* The JSON stream emits NDJSON lines (from seroval's toCrossJSONStream).
* Raw streams are pumped concurrently, interleaved with JSON frames.
*
* Supports late stream registration for RawStreams discovered after initial
* serialization (e.g., from resolved Promises).
*
* @param jsonStream Stream of JSON strings (each string is one NDJSON line)
* @param rawStreams Map of stream IDs to raw binary streams (known at start)
* @param lateStreamSource Optional stream of late registrations for streams discovered later
*/
function createMultiplexedStream(jsonStream, rawStreams, lateStreamSource) {
	let controller;
	let cancelled = false;
	const readers = [];
	const enqueue = (frame) => {
		if (cancelled) return false;
		try {
			controller.enqueue(frame);
			return true;
		} catch {
			return false;
		}
	};
	const errorOutput = (error) => {
		if (cancelled) return;
		cancelled = true;
		try {
			controller.error(error);
		} catch {}
		for (const reader of readers) reader.cancel().catch(() => {});
	};
	async function pumpRawStream(streamId, stream) {
		const reader = stream.getReader();
		readers.push(reader);
		try {
			while (!cancelled) {
				const { done, value } = await reader.read();
				if (done) {
					enqueue(encodeEndFrame(streamId));
					return;
				}
				if (!enqueue(encodeChunkFrame(streamId, value))) return;
			}
		} catch (error) {
			enqueue(encodeErrorFrame(streamId, error));
		} finally {
			reader.releaseLock();
		}
	}
	async function pumpJSON() {
		const reader = jsonStream.getReader();
		readers.push(reader);
		try {
			while (!cancelled) {
				const { done, value } = await reader.read();
				if (done) return;
				if (!enqueue(encodeJSONFrame(value))) return;
			}
		} catch (error) {
			errorOutput(error);
			throw error;
		} finally {
			reader.releaseLock();
		}
	}
	async function pumpLateStreams() {
		if (!lateStreamSource) return [];
		const lateStreamPumps = [];
		const reader = lateStreamSource.getReader();
		readers.push(reader);
		try {
			while (!cancelled) {
				const { done, value } = await reader.read();
				if (done) break;
				lateStreamPumps.push(pumpRawStream(value.id, value.stream));
			}
		} finally {
			reader.releaseLock();
		}
		return lateStreamPumps;
	}
	return new ReadableStream({
		async start(ctrl) {
			controller = ctrl;
			const pumps = [pumpJSON()];
			for (const [streamId, stream] of rawStreams) pumps.push(pumpRawStream(streamId, stream));
			if (lateStreamSource) pumps.push(pumpLateStreams());
			try {
				const latePumps = (await Promise.all(pumps)).find(Array.isArray);
				if (latePumps && latePumps.length > 0) await Promise.all(latePumps);
				if (!cancelled) try {
					controller.close();
				} catch {}
			} catch {}
		},
		cancel() {
			cancelled = true;
			for (const reader of readers) reader.cancel().catch(() => {});
			readers.length = 0;
		}
	});
}
var serovalPlugins = void 0;
var FORM_DATA_CONTENT_TYPES = ["multipart/form-data", "application/x-www-form-urlencoded"];
var MAX_PAYLOAD_SIZE = 1e6;
var handleServerAction = async ({ request, context, serverFnId }) => {
	const methodUpper = request.method.toUpperCase();
	const url = new URL(request.url);
	const action = await getServerFnById(serverFnId, { origin: "client" });
	if (action.method && methodUpper !== action.method) return new Response(`expected ${action.method} method. Got ${methodUpper}`, {
		status: 405,
		headers: { Allow: action.method }
	});
	const isServerFn = request.headers.get("x-tsr-serverFn") === "true";
	if (!serovalPlugins) serovalPlugins = getDefaultSerovalPlugins();
	const contentType = request.headers.get("Content-Type");
	function parsePayload(payload) {
		return fromJSON(payload, { plugins: serovalPlugins });
	}
	return await (async () => {
		try {
			let res = await (async () => {
				if (FORM_DATA_CONTENT_TYPES.some((type) => contentType && contentType.includes(type))) {
					if (methodUpper === "GET") invariant();
					const formData = await request.formData();
					const serializedContext = formData.get(TSS_FORMDATA_CONTEXT);
					formData.delete(TSS_FORMDATA_CONTEXT);
					const params = {
						context,
						data: formData,
						method: methodUpper
					};
					if (typeof serializedContext === "string") try {
						const deserializedContext = fromJSON(JSON.parse(serializedContext), { plugins: serovalPlugins });
						if (typeof deserializedContext === "object" && deserializedContext) params.context = safeObjectMerge(deserializedContext, context);
					} catch (e) {}
					return await action(params);
				}
				if (methodUpper === "GET") {
					const payloadParam = url.searchParams.get("payload");
					if (payloadParam && payloadParam.length > MAX_PAYLOAD_SIZE) throw new Error("Payload too large");
					const payload = payloadParam ? parsePayload(JSON.parse(payloadParam)) : {};
					payload.context = safeObjectMerge(payload.context, context);
					payload.method = methodUpper;
					return await action(payload);
				}
				let jsonPayload;
				if (contentType?.includes("application/json")) jsonPayload = await request.json();
				const payload = jsonPayload ? parsePayload(jsonPayload) : {};
				payload.context = safeObjectMerge(payload.context, context);
				payload.method = methodUpper;
				return await action(payload);
			})();
			const unwrapped = res.result || res.error;
			if (isNotFound(res)) res = isNotFoundResponse(res);
			if (!isServerFn) return unwrapped;
			if (unwrapped instanceof Response) {
				if (isRedirect(unwrapped)) return unwrapped;
				unwrapped.headers.set(X_TSS_RAW_RESPONSE, "true");
				return unwrapped;
			}
			return serializeResult(res);
			function serializeResult(res) {
				let nonStreamingBody = void 0;
				const alsResponse = getResponse();
				if (res !== void 0) {
					const rawStreams = /* @__PURE__ */ new Map();
					let initialPhase = true;
					let lateStreamWriter;
					let lateStreamReadable = void 0;
					const pendingLateStreams = [];
					const plugins = [createRawStreamRPCPlugin((id, stream) => {
						if (initialPhase) {
							rawStreams.set(id, stream);
							return;
						}
						if (lateStreamWriter) {
							lateStreamWriter.write({
								id,
								stream
							}).catch(() => {});
							return;
						}
						pendingLateStreams.push({
							id,
							stream
						});
					}), ...serovalPlugins || []];
					let done = false;
					const callbacks = {
						onParse: (value) => {
							nonStreamingBody = value;
						},
						onDone: () => {
							done = true;
						},
						onError: (error) => {
							throw error;
						}
					};
					toCrossJSONStream(res, {
						refs: /* @__PURE__ */ new Map(),
						plugins,
						onParse(value) {
							callbacks.onParse(value);
						},
						onDone() {
							callbacks.onDone();
						},
						onError: (error) => {
							callbacks.onError(error);
						}
					});
					initialPhase = false;
					if (done && rawStreams.size === 0) return new Response(nonStreamingBody ? JSON.stringify(nonStreamingBody) : void 0, {
						status: alsResponse.status,
						statusText: alsResponse.statusText,
						headers: {
							"Content-Type": "application/json",
							[X_TSS_SERIALIZED]: "true"
						}
					});
					const { readable, writable } = new TransformStream();
					lateStreamReadable = readable;
					lateStreamWriter = writable.getWriter();
					for (const registration of pendingLateStreams) lateStreamWriter.write(registration).catch(() => {});
					pendingLateStreams.length = 0;
					const multiplexedStream = createMultiplexedStream(new ReadableStream({
						start(controller) {
							callbacks.onParse = (value) => {
								controller.enqueue(JSON.stringify(value) + "\n");
							};
							callbacks.onDone = () => {
								try {
									controller.close();
								} catch {}
								lateStreamWriter?.close().catch(() => {}).finally(() => {
									lateStreamWriter = void 0;
								});
							};
							callbacks.onError = (error) => {
								controller.error(error);
								lateStreamWriter?.abort(error).catch(() => {}).finally(() => {
									lateStreamWriter = void 0;
								});
							};
							if (nonStreamingBody !== void 0) callbacks.onParse(nonStreamingBody);
							if (done) callbacks.onDone();
						},
						cancel() {
							lateStreamWriter?.abort().catch(() => {});
							lateStreamWriter = void 0;
						}
					}), rawStreams, lateStreamReadable);
					return new Response(multiplexedStream, {
						status: alsResponse.status,
						statusText: alsResponse.statusText,
						headers: {
							"Content-Type": TSS_CONTENT_TYPE_FRAMED_VERSIONED,
							[X_TSS_SERIALIZED]: "true"
						}
					});
				}
				return new Response(void 0, {
					status: alsResponse.status,
					statusText: alsResponse.statusText
				});
			}
		} catch (error) {
			if (error instanceof Response) return error;
			if (isNotFound(error)) return isNotFoundResponse(error);
			console.info();
			console.info("Server Fn Error!");
			console.info();
			console.error(error);
			console.info();
			const serializedError = JSON.stringify(await Promise.resolve(toCrossJSONAsync(error, {
				refs: /* @__PURE__ */ new Map(),
				plugins: serovalPlugins
			})));
			const response = getResponse();
			return new Response(serializedError, {
				status: response.status ?? 500,
				statusText: response.statusText,
				headers: {
					"Content-Type": "application/json",
					[X_TSS_SERIALIZED]: "true"
				}
			});
		}
	})();
};
function isNotFoundResponse(error) {
	const { headers, ...rest } = error;
	return new Response(JSON.stringify(rest), {
		status: 404,
		headers: {
			"Content-Type": "application/json",
			...headers || {}
		}
	});
}
var LINK_PARAM_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
var PRELOAD_AS_VALUES = /* @__PURE__ */ new Set([
	"fetch",
	"font",
	"image",
	"script",
	"style",
	"track"
]);
function buildLinkParam(name, value) {
	if (value === void 0) return name;
	if (LINK_PARAM_TOKEN_RE.test(value)) return `${name}=${value}`;
	return `${name}=${JSON.stringify(value)}`;
}
function serializeEarlyHint(hint) {
	const parts = [`<${hint.href}>`, buildLinkParam("rel", hint.rel)];
	if (hint.as) parts.push(buildLinkParam("as", hint.as));
	if (hint.crossOrigin !== void 0) parts.push(buildLinkParam("crossorigin", hint.crossOrigin || void 0));
	if (hint.type) parts.push(buildLinkParam("type", hint.type));
	if (hint.integrity) parts.push(buildLinkParam("integrity", hint.integrity));
	if (hint.referrerPolicy) parts.push(buildLinkParam("referrerpolicy", hint.referrerPolicy));
	if (hint.fetchPriority) parts.push(buildLinkParam("fetchpriority", hint.fetchPriority));
	return parts.join("; ");
}
function getStringAttr(attrs, name, fallbackName) {
	const value = attrs?.[name] ?? (fallbackName ? attrs?.[fallbackName] : void 0);
	return typeof value === "string" ? value : void 0;
}
function getPreloadAs(attrs) {
	const as = getStringAttr(attrs, "as");
	return as && PRELOAD_AS_VALUES.has(as) ? as : void 0;
}
function addEarlyHintFetchAttrs(hint, attrs) {
	const crossOrigin = getStringAttr(attrs, "crossOrigin", "crossorigin");
	const type = getStringAttr(attrs, "type");
	const integrity = getStringAttr(attrs, "integrity");
	const referrerPolicy = getStringAttr(attrs, "referrerPolicy", "referrerpolicy");
	const fetchPriority = getStringAttr(attrs, "fetchPriority", "fetchpriority");
	if (crossOrigin !== void 0) hint.crossOrigin = crossOrigin;
	if (type) hint.type = type;
	if (integrity) hint.integrity = integrity;
	if (referrerPolicy) hint.referrerPolicy = referrerPolicy;
	if (fetchPriority) hint.fetchPriority = fetchPriority;
}
function linkAttrsToEarlyHint(attrs) {
	const href = getStringAttr(attrs, "href");
	const rel = getStringAttr(attrs, "rel");
	if (!href || !rel) return void 0;
	const relTokens = rel.split(/\s+/);
	let hintRel;
	let hintAs;
	if (relTokens.includes("modulepreload")) {
		hintRel = "modulepreload";
		hintAs = "script";
	} else if (relTokens.includes("stylesheet")) {
		hintRel = "preload";
		hintAs = "style";
	} else if (relTokens.includes("preload")) {
		hintAs = getPreloadAs(attrs);
		if (!hintAs) return void 0;
		hintRel = "preload";
	} else if (relTokens.includes("preconnect")) {
		hintRel = "preconnect";
		hintAs = void 0;
	} else if (relTokens.includes("dns-prefetch")) {
		hintRel = "dns-prefetch";
		hintAs = void 0;
	}
	if (!hintRel) return void 0;
	const hint = {
		href,
		rel: hintRel
	};
	if (hintAs) hint.as = hintAs;
	addEarlyHintFetchAttrs(hint, attrs);
	return hint;
}
function collectStaticHintsFromManifest(manifest, matchedRoutes) {
	const hints = [];
	for (const route of matchedRoutes) {
		const routeManifest = manifest.routes[route.id];
		if (!routeManifest) continue;
		for (const link of routeManifest.preloads ?? []) {
			const attrs = getScriptPreloadAttrs(manifest, link);
			const hint = {
				href: attrs.href,
				rel: attrs.rel,
				as: "script"
			};
			if (attrs.crossOrigin !== void 0) hint.crossOrigin = attrs.crossOrigin;
			hints.push(hint);
		}
		for (const link of routeManifest.css ?? []) {
			const stylesheetHref = getStylesheetHref(link);
			if (manifest.inlineCss?.styles[stylesheetHref] !== void 0) continue;
			const resolvedLink = resolveManifestCssLink(link);
			const hint = {
				href: stylesheetHref,
				rel: "preload",
				as: "style"
			};
			if (resolvedLink.crossOrigin !== void 0) hint.crossOrigin = resolvedLink.crossOrigin;
			hints.push(hint);
		}
	}
	return hints;
}
function collectDynamicHintsFromMatches(matches) {
	const hints = [];
	for (const match of matches) {
		const links = match.links;
		if (!Array.isArray(links)) continue;
		for (const link of links) {
			const hint = linkAttrsToEarlyHint(link);
			if (hint) hints.push(hint);
		}
	}
	return hints;
}
function createEarlyHintsEvent(opts) {
	const nextHints = [];
	const nextLinks = [];
	for (const hint of opts.hints) {
		const link = serializeEarlyHint(hint);
		if (opts.sentLinks.has(link)) continue;
		opts.sentLinks.add(link);
		opts.sentHints.push(hint);
		nextHints.push(hint);
		nextLinks.push(link);
	}
	if (!nextHints.length && opts.phase !== "dynamic") return void 0;
	return {
		phase: opts.phase,
		hints: nextHints,
		links: nextLinks,
		allHints: opts.sentHints.slice(),
		allLinks: Array.from(opts.sentLinks)
	};
}
function createResponseLinkHeaderEntries(opts) {
	for (const hint of opts.hints) {
		const link = serializeEarlyHint(hint);
		if (opts.sentLinks.has(link)) continue;
		opts.sentLinks.add(link);
		opts.entries.push({
			phase: opts.phase,
			hint,
			link
		});
	}
}
function getResponseLinkHeaderEntries(opts) {
	if (!opts.filter) return opts.entries.map((entry) => entry.link);
	try {
		const links = [];
		for (const entry of opts.entries) if (opts.filter(entry)) links.push(entry.link);
		return links;
	} catch (err) {
		console.error("Error filtering response Link headers:", err);
		return [];
	}
}
function notifyEarlyHints(phase, event, onEarlyHints) {
	try {
		const result = onEarlyHints(event);
		if (result) Promise.resolve(result).catch((err) => {
			console.error(`Error sending ${phase} early hints:`, err);
		});
	} catch (err) {
		console.error(`Error sending ${phase} early hints:`, err);
	}
}
function getResponseLinkHeaderFilter(responseLinkHeader) {
	if (typeof responseLinkHeader !== "object") return;
	return responseLinkHeader.filter;
}
function appendResponseLinkHeaders(opts) {
	for (const link of getResponseLinkHeaderEntries(opts)) opts.responseHeaders.append("Link", link);
}
function collectResponseLinkHeaderEntries(opts) {
	for (let index = 0; index < opts.event.hints.length; index++) opts.entries.push({
		phase: opts.phase,
		hint: opts.event.hints[index],
		link: opts.event.links[index]
	});
}
function collectEarlyHintsPhase(opts) {
	const event = opts.onEarlyHints ? createEarlyHintsEvent({
		phase: opts.phase,
		hints: opts.hints,
		sentLinks: opts.sentLinks,
		sentHints: opts.sentHints
	}) : void 0;
	if (event) notifyEarlyHints(opts.phase, event, opts.onEarlyHints);
	if (!opts.responseLinkHeaderEntries) return;
	if (event) {
		collectResponseLinkHeaderEntries({
			phase: opts.phase,
			event,
			entries: opts.responseLinkHeaderEntries
		});
		return;
	}
	createResponseLinkHeaderEntries({
		phase: opts.phase,
		hints: opts.hints,
		sentLinks: opts.sentLinks,
		entries: opts.responseLinkHeaderEntries
	});
}
function createEarlyHintsCollector(opts) {
	if (!opts?.onEarlyHints && !opts?.responseLinkHeader) return;
	const sentLinks = /* @__PURE__ */ new Set();
	const sentHints = opts.onEarlyHints ? new Array() : void 0;
	const responseLinkHeaderEntries = opts.responseLinkHeader ? new Array() : void 0;
	const responseLinkHeaderFilter = getResponseLinkHeaderFilter(opts.responseLinkHeader);
	return {
		collectStatic: ({ manifest, matchedRoutes }) => {
			if (!matchedRoutes?.length) return;
			collectEarlyHintsPhase({
				phase: "static",
				hints: collectStaticHintsFromManifest(manifest, matchedRoutes),
				sentLinks,
				sentHints,
				onEarlyHints: opts.onEarlyHints,
				responseLinkHeaderEntries
			});
		},
		collectDynamic: (matches) => {
			collectEarlyHintsPhase({
				phase: "dynamic",
				hints: collectDynamicHintsFromMatches(matches),
				sentLinks,
				sentHints,
				onEarlyHints: opts.onEarlyHints,
				responseLinkHeaderEntries
			});
		},
		appendResponseHeaders: (headers) => {
			if (!responseLinkHeaderEntries?.length) return;
			appendResponseLinkHeaders({
				responseHeaders: headers,
				entries: responseLinkHeaderEntries,
				filter: responseLinkHeaderFilter
			});
		}
	};
}
function normalizeTransformAssetResult(result) {
	if (typeof result === "string") return { href: result };
	return result;
}
function escapeCssString(value) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\a ").replace(/\r/g, "\\d ").replace(/\f/g, "\\c ");
}
async function transformInlineCssTemplate(options) {
	const { strings, urls } = options.template;
	if (strings.length !== urls.length + 1) throw new Error(`TanStack Start inlineCss template for ${options.stylesheetHref} is invalid`);
	let css = strings[0];
	for (let index = 0; index < urls.length; index++) {
		const transformed = normalizeTransformAssetResult(await options.transformFn({
			kind: "css-url",
			url: urls[index],
			stylesheetHref: options.stylesheetHref
		}));
		css += escapeCssString(transformed.href) + strings[index + 1];
	}
	return css;
}
async function transformInlineCssStyles(inlineCss, transformFn) {
	const transformedStyles = {};
	const transformedEntries = await Promise.all(Object.entries(inlineCss.styles).map(async ([stylesheetHref, css]) => {
		const template = inlineCss.templates?.[stylesheetHref];
		return [stylesheetHref, template ? await transformInlineCssTemplate({
			stylesheetHref,
			template,
			transformFn
		}) : css];
	}));
	for (const [stylesheetHref, css] of transformedEntries) transformedStyles[stylesheetHref] = css;
	return {
		styles: transformedStyles,
		...inlineCss.templates ? { templates: inlineCss.templates } : {}
	};
}
function resolveTransformAssetsCrossOrigin(config, kind) {
	if (!config) return void 0;
	if (typeof config === "string") return config;
	return config[kind];
}
function isObjectShorthand(transform) {
	return "prefix" in transform;
}
function resolveTransformAssetsConfig(transform) {
	if (typeof transform === "string") {
		const prefix = transform;
		return {
			type: "transform",
			transformFn: ({ url }) => ({ href: `${prefix}${url}` }),
			cache: true
		};
	}
	if (typeof transform === "function") return {
		type: "transform",
		transformFn: transform,
		cache: true
	};
	if (isObjectShorthand(transform)) {
		const { prefix, crossOrigin } = transform;
		return {
			type: "transform",
			transformFn: ({ url, kind }) => {
				const href = `${prefix}${url}`;
				if (kind === "css-url") return { href };
				const co = resolveTransformAssetsCrossOrigin(crossOrigin, kind);
				return co ? {
					href,
					crossOrigin: co
				} : { href };
			},
			cache: true
		};
	}
	if ("createTransform" in transform && transform.createTransform) return {
		type: "createTransform",
		createTransform: transform.createTransform,
		cache: transform.cache !== false
	};
	return {
		type: "transform",
		transformFn: typeof transform.transform === "string" ? (({ url }) => ({ href: `${transform.transform}${url}` })) : transform.transform,
		cache: transform.cache !== false
	};
}
function assignManifestLink(link, next) {
	if (typeof link === "string") return next.crossOrigin ? next : next.href;
	const nextLink = {
		...link,
		href: next.href
	};
	if (next.crossOrigin) nextLink.crossOrigin = next.crossOrigin;
	else delete nextLink.crossOrigin;
	return nextLink;
}
async function transformManifestAssets(source, transformFn, _opts) {
	const manifest = structuredClone(source);
	const inlineCssEnabled = _opts?.inlineCss !== false;
	const scriptTransforms = /* @__PURE__ */ new Map();
	const transformScript = (url) => {
		const cached = scriptTransforms.get(url);
		if (cached) return cached;
		const transformed = Promise.resolve(transformFn({
			url,
			kind: "script"
		})).then(normalizeTransformAssetResult);
		scriptTransforms.set(url, transformed);
		return transformed;
	};
	if (!inlineCssEnabled) delete manifest.inlineCss;
	else if (manifest.inlineCss) manifest.inlineCss = await transformInlineCssStyles(manifest.inlineCss, transformFn);
	for (const route of Object.values(manifest.routes)) {
		if (route.preloads?.length) route.preloads = await Promise.all(route.preloads.map(async (link) => {
			const result = await transformScript(resolveManifestAssetLink(link).href);
			return assignManifestLink(link, {
				href: result.href,
				crossOrigin: result.crossOrigin
			});
		}));
		if (route.css?.length && !manifest.inlineCss) route.css = await Promise.all(route.css.map(async (link) => {
			const result = normalizeTransformAssetResult(await transformFn({
				url: resolveManifestCssLink(link).href,
				kind: "stylesheet"
			}));
			return assignManifestLink(link, {
				href: result.href,
				crossOrigin: result.crossOrigin
			});
		}));
		if (route.scripts?.length) for (const script of route.scripts) {
			const src = script.attrs?.src;
			if (typeof src !== "string") continue;
			const result = await transformScript(src);
			script.attrs = {
				...script.attrs,
				src: result.href
			};
			if (result.crossOrigin) script.attrs.crossOrigin = result.crossOrigin;
			else delete script.attrs.crossOrigin;
		}
	}
	return manifest;
}
/**
* Builds a final ServerManifest without URL transforms. Used when no
* transformAssets option is provided.
*
* Returns a new manifest object so the cached base manifest is never mutated.
*/
function buildManifest(source, opts) {
	return {
		...source.scriptFormat ? { scriptFormat: source.scriptFormat } : {},
		...opts?.inlineCss !== false && source.inlineCss ? { inlineCss: structuredClone(source.inlineCss) } : {},
		routes: { ...source.routes }
	};
}
function getStaticHandlerInlineCssDefault(handlerInlineCss) {
	if (typeof handlerInlineCss === "function") return;
	return handlerInlineCss ?? true;
}
async function resolveInlineCssForRequest(opts) {
	if (opts.requestInlineCss !== void 0) return opts.requestInlineCss;
	if (typeof opts.handlerInlineCss === "function") return await opts.handlerInlineCss({ request: opts.request });
	return opts.handlerInlineCss ?? true;
}
function createCachedBaseManifestLoader(loadBaseManifest) {
	let baseManifestPromise;
	return () => {
		if (!baseManifestPromise) baseManifestPromise = loadBaseManifest().catch((error) => {
			baseManifestPromise = void 0;
			throw error;
		});
		return baseManifestPromise;
	};
}
function createFinalManifestTransformResolver(transformAssets, opts) {
	const transformConfig = transformAssets !== void 0 ? resolveTransformAssetsConfig(transformAssets) : void 0;
	const cache = transformConfig ? transformConfig.cache : true;
	const warmup = !!transformAssets && typeof transformAssets === "object" && "warmup" in transformAssets && transformAssets.warmup === true;
	let cachedCreateTransformPromise;
	const clearCachedCreateTransform = () => {
		cachedCreateTransformPromise = void 0;
	};
	return {
		cache,
		warmup,
		clearCachedCreateTransform,
		getTransformFn: async (ctx) => {
			if (!transformConfig) return void 0;
			if (transformConfig.type !== "createTransform") return transformConfig.transformFn;
			if (!cache || !opts.cacheCreateTransform) return transformConfig.createTransform(ctx);
			if (!cachedCreateTransformPromise) cachedCreateTransformPromise = Promise.resolve(transformConfig.createTransform(ctx)).catch((error) => {
				clearCachedCreateTransform();
				throw error;
			});
			return cachedCreateTransformPromise;
		}
	};
}
function createFinalManifestResolver(opts) {
	const finalManifestCache = /* @__PURE__ */ new Map();
	const transformResolver = createFinalManifestTransformResolver(opts.transformAssets, { cacheCreateTransform: opts.cacheCreateTransform });
	const handlerDefaultInlineCss = getStaticHandlerInlineCssDefault(opts.inlineCss);
	const getRequestManifestOptions = async (requestOpts) => {
		const transformFn = await transformResolver.getTransformFn({
			warmup: false,
			request: requestOpts.request
		});
		const inlineCss = await resolveInlineCssForRequest({
			request: requestOpts.request,
			handlerInlineCss: opts.inlineCss,
			requestInlineCss: requestOpts.requestInlineCss
		});
		return {
			getBaseManifest: requestOpts.getBaseManifest,
			transformFn,
			cache: transformResolver.cache,
			inlineCss
		};
	};
	const resolveRequest = async (requestOpts, cache) => {
		return resolveFinalManifest({
			...await getRequestManifestOptions(requestOpts),
			finalManifestCache: cache
		});
	};
	return {
		warmup: ({ getBaseManifest }) => warmupFinalManifest({
			enabled: transformResolver.warmup,
			handlerDefaultInlineCss,
			cache: transformResolver.cache,
			finalManifestCache,
			getBaseManifest,
			getTransformFn: () => transformResolver.getTransformFn({ warmup: true }),
			onError: transformResolver.clearCachedCreateTransform
		}),
		resolveCached: (requestOpts) => resolveRequest(requestOpts, finalManifestCache),
		resolveUncached: (requestOpts) => resolveRequest(requestOpts, void 0)
	};
}
function getFinalManifestCacheKey(inlineCss) {
	return inlineCss ? "inline-css" : "linked-css";
}
function cacheFinalManifestPromise(cachedFinalManifestPromises, cacheKey, promise) {
	const cachedFinalManifestPromise = promise.catch((error) => {
		if (cachedFinalManifestPromises.get(cacheKey) === cachedFinalManifestPromise) cachedFinalManifestPromises.delete(cacheKey);
		throw error;
	});
	cachedFinalManifestPromises.set(cacheKey, cachedFinalManifestPromise);
	return cachedFinalManifestPromise;
}
function getOrCreateCachedFinalManifestPromise(cachedFinalManifestPromises, cacheKey, computeFinalManifest) {
	const cachedFinalManifestPromise = cachedFinalManifestPromises.get(cacheKey);
	if (cachedFinalManifestPromise) return cachedFinalManifestPromise;
	return cacheFinalManifestPromise(cachedFinalManifestPromises, cacheKey, Promise.resolve().then(computeFinalManifest));
}
async function buildFinalManifest(opts) {
	return opts.transformFn ? await transformManifestAssets(opts.base, opts.transformFn, { inlineCss: opts.inlineCss }) : buildManifest(opts.base, { inlineCss: opts.inlineCss });
}
async function resolveFinalManifest(opts) {
	const computeFinalManifest = async () => {
		return buildFinalManifest({
			base: await opts.getBaseManifest(),
			transformFn: opts.transformFn,
			inlineCss: opts.inlineCss
		});
	};
	if (opts.finalManifestCache && (!opts.transformFn || opts.cache)) return getOrCreateCachedFinalManifestPromise(opts.finalManifestCache, getFinalManifestCacheKey(opts.inlineCss), computeFinalManifest);
	return computeFinalManifest();
}
function warmupFinalManifest(opts) {
	if (!opts.enabled || opts.handlerDefaultInlineCss === void 0 || !opts.cache) return;
	const inlineCss = opts.handlerDefaultInlineCss;
	const warmupPromise = getOrCreateCachedFinalManifestPromise(opts.finalManifestCache, getFinalManifestCacheKey(inlineCss), async () => {
		const [base, transformFn] = await Promise.all([opts.getBaseManifest(), opts.getTransformFn()]);
		return buildFinalManifest({
			base,
			transformFn,
			inlineCss
		});
	});
	if (opts.onError) warmupPromise.catch(opts.onError);
	return warmupPromise;
}
var ServerFunctionSerializationAdapter = createSerializationAdapter({
	key: "$TSS/serverfn",
	test: (v) => {
		if (typeof v !== "function") return false;
		if (!(TSS_SERVER_FUNCTION in v)) return false;
		return !!v[TSS_SERVER_FUNCTION];
	},
	toSerializable: ({ serverFnMeta }) => ({ functionId: serverFnMeta.id }),
	fromSerializable: ({ functionId }) => {
		const fn = async (opts, signal) => {
			return (await (await getServerFnById(functionId, { origin: "client" }))(opts ?? {}, signal)).result;
		};
		return fn;
	}
});
function getStartResponseHeaders(opts) {
	return mergeHeaders({ "Content-Type": "text/html; charset=utf-8" }, ..._getRenderedMatches(opts.router.stores.matches.get()).map((match) => {
		return match.headers;
	}));
}
var entriesPromise;
var defaultCsrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });
var getCachedBaseManifest = createCachedBaseManifestLoader(() => getStartManifest());
var getProdBaseManifest = () => getCachedBaseManifest();
var getBaseManifest = getProdBaseManifest;
var createEarlyHintsForRequest = createEarlyHintsCollector;
async function loadEntries() {
	const [routerEntry, startEntry, pluginAdapters] = await Promise.all([
		import("./router-CZoe1CmJ.mjs").then((n) => n.t),
		import("./start-5Z2QO8AU.mjs"),
		import("./empty-plugin-adapters-D9UWiqvJ.mjs")
	]);
	return {
		routerEntry,
		startEntry,
		pluginAdapters
	};
}
function getEntries() {
	if (!entriesPromise) entriesPromise = loadEntries();
	return entriesPromise;
}
var ROUTER_BASEPATH = "/";
var SERVER_FN_BASE = "/_serverFn/";
var IS_PRERENDERING = process.env.TSS_PRERENDERING === "true";
var IS_SHELL_ENV = process.env.TSS_SHELL === "true";
var IS_DEV = false;
var ERR_NO_RESPONSE = IS_DEV ? `It looks like you forgot to return a response from your server route handler. If you want to defer to the app router, make sure to have a component set in this route.` : "Internal Server Error";
var ERR_NO_DEFER = IS_DEV ? `You cannot defer to the app router if there is no component defined on this route.` : "Internal Server Error";
function throwRouteHandlerError() {
	throw new Error(ERR_NO_RESPONSE);
}
function throwIfMayNotDefer() {
	throw new Error(ERR_NO_DEFER);
}
/**
* Check if a value is a special response (Response or Redirect)
*/
function isSpecialResponse(value) {
	return value instanceof Response || isRedirect(value);
}
/**
* Normalize middleware result to context shape
*/
function handleCtxResult(result) {
	if (isSsrResponse(result) || isSpecialResponse(result)) return { response: result };
	return result;
}
function disposeLateResponse(result, signal) {
	const response = handleCtxResult(result)?.response;
	if (isSsrResponse(response) || isSpecialResponse(response)) disposeSsrResponseDetached(response, signal.reason);
}
function isSignalAborted(signal) {
	return signal.aborted;
}
/**
* Execute a middleware chain
*/
async function executeMiddleware(middlewares, ctx, signal) {
	let index = -1;
	let streamResponse;
	let retiredStreamIdentities;
	const isResponseAlias = (candidate, response) => candidate === response || candidate instanceof Response && response.body !== null && candidate.body === response.body;
	const setResponse = (response) => {
		if (isSsrResponse(response)) {
			if (response.serverSsrCleanup === "stream") streamResponse = response;
			ctx.response = response.response;
			return;
		}
		ctx.response = response;
	};
	const disposeStreamResponse = async (reason) => {
		const response = streamResponse;
		if (!response) return;
		streamResponse = void 0;
		retiredStreamIdentities ??= /* @__PURE__ */ new WeakSet();
		retiredStreamIdentities.add(response.response);
		if (response.response.body) retiredStreamIdentities.add(response.response.body);
		const currentResponse = ctx.response;
		if (isResponseAlias(currentResponse, response.response)) ctx.response = void 0;
		await response.dispose(reason);
	};
	const disposeAbandonedResult = (result) => {
		const exposed = handleCtxResult(result)?.response;
		const response = isSsrResponse(exposed) ? exposed.response : exposed;
		if (streamResponse && isResponseAlias(response, streamResponse.response)) {
			disposeStreamResponse(signal.reason).catch(console.error);
			return;
		}
		if (response instanceof Response && retiredStreamIdentities && (retiredStreamIdentities.has(response) || response.body !== null && retiredStreamIdentities.has(response.body))) return;
		disposeLateResponse(result, signal);
	};
	const getFinalResponse = async () => {
		const response = ctx.response;
		if (!response) throwRouteHandlerError();
		if (!streamResponse) return response;
		if (response === streamResponse.response) return streamResponse;
		if (streamResponse.response.body !== null && response.body === streamResponse.response.body) return {
			...streamResponse,
			response
		};
		await disposeStreamResponse("middleware response replaced");
		return response;
	};
	let nextPromise;
	function next(nextCtx) {
		const result = runNext(nextCtx);
		nextPromise = result;
		return result;
	}
	async function runNext(nextCtx) {
		if (signal.aborted) throw signal.reason;
		if (nextCtx) {
			if (nextCtx.context) ctx.context = safeObjectMerge(ctx.context, nextCtx.context);
			for (const key of Object.keys(nextCtx)) if (key === "response") setResponse(nextCtx.response);
			else if (key !== "context") ctx[key] = nextCtx[key];
		}
		index++;
		const middleware = middlewares[index];
		if (!middleware) return ctx;
		let result;
		try {
			const pending = middleware({
				...ctx,
				next
			});
			if (pending === nextPromise) {
				nextPromise = void 0;
				result = await pending;
				if (isSignalAborted(signal)) {
					disposeAbandonedResult(result);
					throw signal.reason;
				}
			} else result = await waitForRequest(pending, signal, disposeAbandonedResult);
		} catch (err) {
			if (isSignalAborted(signal)) throw signal.reason;
			if (isSpecialResponse(err)) {
				setResponse(err);
				return ctx;
			}
			throw err;
		}
		const normalized = handleCtxResult(result);
		if (normalized) {
			if (normalized.response !== void 0) setResponse(normalized.response);
			if (normalized.context) ctx.context = safeObjectMerge(ctx.context, normalized.context);
		}
		return ctx;
	}
	try {
		await runNext();
		const response = await waitForRequest(getFinalResponse(), signal, disposeAbandonedResult);
		if (signal.aborted) {
			disposeAbandonedResult(response);
			throw signal.reason;
		}
		return {
			ctx,
			response
		};
	} catch (err) {
		const disposal = disposeStreamResponse(signal.aborted ? signal.reason : err);
		if (signal.aborted) disposal.catch(console.error);
		else await disposal;
		throw err;
	}
}
/**
* Wrap a route handler as middleware
*/
function handlerToMiddleware(handler, mayDefer = false) {
	if (mayDefer) return handler;
	return async (ctx) => {
		const response = await handler({
			...ctx,
			next: throwIfMayNotDefer
		});
		if (!response) throwRouteHandlerError();
		return response;
	};
}
/**
* Creates the TanStack Start request handler.
*
* @example Backwards-compatible usage (handler callback only):
* ```ts
* export default createStartHandler(defaultStreamHandler)
* ```
*
* @example With CDN URL rewriting:
* ```ts
* export default createStartHandler({
*   handler: defaultStreamHandler,
*   transformAssets: 'https://cdn.example.com',
* })
* ```
*
* @example With per-request URL rewriting:
* ```ts
* export default createStartHandler({
*   handler: defaultStreamHandler,
*   transformAssets: {
*     transform: ({ url }) => {
*       const cdnBase = getRequest().headers.get('x-cdn-base') || ''
*       return { href: `${cdnBase}${url}` }
*     },
*     cache: false,
*   },
* })
* ```
*/
function createStartHandler(cbOrOptions) {
	const handlerOptions = typeof cbOrOptions === "function" ? {} : cbOrOptions;
	const cb = typeof cbOrOptions === "function" ? cbOrOptions : cbOrOptions.handler;
	const finalManifestResolver = createFinalManifestResolver({
		...handlerOptions,
		cacheCreateTransform: true
	});
	const resolveManifestForRequest = finalManifestResolver.resolveCached;
	finalManifestResolver.warmup({ getBaseManifest: () => getBaseManifest(void 0) });
	const startRequestResolver = async (request, requestOpts) => {
		let router = null;
		let responseOwnsCleanup = false;
		try {
			request.signal.throwIfAborted();
			const { url, handledProtocolRelativeURL } = getNormalizedURL(request.url);
			const href = url.pathname + url.search + url.hash;
			const origin = getOrigin(request);
			if (handledProtocolRelativeURL) return Response.redirect(url, 308);
			const entries = await waitForRequest(getEntries(), request.signal);
			const hasStartInstance = !!entries.startEntry.startInstance;
			const startOptions = await waitForRequest(entries.startEntry.startInstance?.getOptions(), request.signal) || {};
			const { hasPluginAdapters, pluginSerializationAdapters } = entries.pluginAdapters;
			const serializationAdapters = [
				...startOptions.serializationAdapters || [],
				...hasPluginAdapters ? pluginSerializationAdapters : [],
				ServerFunctionSerializationAdapter
			];
			const requestStartOptions = {
				...startOptions,
				requestMiddleware: hasStartInstance ? startOptions.requestMiddleware : [defaultCsrfMiddleware],
				serializationAdapters
			};
			const flattenedRequestMiddlewares = requestStartOptions.requestMiddleware ? flattenMiddlewares(requestStartOptions.requestMiddleware) : [];
			const executedRequestMiddlewares = new Set(flattenedRequestMiddlewares);
			const getRouter = async () => {
				if (router) return router;
				router = await waitForRequest(entries.routerEntry.getRouter(), request.signal);
				let isShell = IS_SHELL_ENV;
				if (IS_PRERENDERING && !isShell) isShell = request.headers.get(HEADERS.TSS_SHELL) === "true";
				const history = createMemoryHistory({ initialEntries: [href] });
				router.update({
					history,
					isShell,
					isPrerendering: IS_PRERENDERING,
					origin: router.options.origin ?? origin,
					defaultSsr: requestStartOptions.defaultSsr,
					serializationAdapters: [...requestStartOptions.serializationAdapters, ...router.options.serializationAdapters || []],
					basepath: ROUTER_BASEPATH
				});
				return router;
			};
			if (SERVER_FN_BASE && url.pathname.startsWith(SERVER_FN_BASE)) {
				const serverFnId = url.pathname.slice(SERVER_FN_BASE.length).split("/")[0];
				if (!serverFnId) throw new Error("Invalid server action param for serverFnId");
				const serverFnHandler = async ({ context }) => {
					return runWithStartContext({
						getRouter,
						startOptions: requestStartOptions,
						contextAfterGlobalMiddlewares: context,
						request,
						executedRequestMiddlewares,
						handlerType: "serverFn"
					}, () => handleServerAction({
						request,
						context: requestOpts?.context,
						serverFnId
					}));
				};
				const { response: middlewareResponse } = await executeMiddleware([...flattenedRequestMiddlewares.map((d) => d.options.server), serverFnHandler], {
					request,
					pathname: url.pathname,
					handlerType: "serverFn",
					context: createNullProtoObject(requestOpts?.context)
				}, request.signal);
				const result = await handleRedirectResponse(middlewareResponse, request, getRouter, request.signal);
				bindSsrResponseToRequest(router ?? void 0, result, request.signal);
				request.signal.throwIfAborted();
				responseOwnsCleanup = result.serverSsrCleanup === "stream";
				return result.response;
			}
			const executeRouter = async (serverContext, matchedRoutes) => {
				const acceptParts = (request.headers.get("Accept") || "*/*").split(",");
				if (!["*/*", "text/html"].some((mimeType) => acceptParts.some((part) => part.trim().startsWith(mimeType)))) return normalizeSsrResponse(Response.json({ error: "Only HTML requests are supported here" }, { status: 500 }));
				const manifest = await waitForRequest(resolveManifestForRequest({
					request,
					requestInlineCss: requestOpts?.inlineCss,
					getBaseManifest: () => getBaseManifest(matchedRoutes)
				}), request.signal);
				const earlyHints = createEarlyHintsForRequest({
					onEarlyHints: requestOpts?.onEarlyHints,
					responseLinkHeader: requestOpts?.responseLinkHeader
				});
				earlyHints?.collectStatic({
					manifest,
					matchedRoutes
				});
				const routerInstance = await getRouter();
				attachRouterServerSsrUtils({
					router: routerInstance,
					manifest,
					getRequestAssets: () => getStartContext({ throwIfNotFound: false })?.requestAssets
				});
				routerInstance.options.additionalContext = { serverContext };
				await routerInstance.load({ _signal: request.signal });
				request.signal.throwIfAborted();
				if (routerInstance._serverResult?.type === "redirect") return normalizeSsrResponse(routerInstance._serverResult.redirect);
				earlyHints?.collectDynamic(_getRenderedMatches(routerInstance.stores.matches.get()));
				const ctx = getStartContext({ throwIfNotFound: false });
				await waitForRequest(routerInstance.serverSsr.dehydrate({ requestAssets: ctx?.requestAssets }), request.signal);
				request.signal.throwIfAborted();
				const responseHeaders = getStartResponseHeaders({ router: routerInstance });
				earlyHints?.appendResponseHeaders(responseHeaders);
				request.signal.throwIfAborted();
				return normalizeSsrResponse(await waitForRequest(cb({
					request,
					router: routerInstance,
					responseHeaders
				}), request.signal, (late) => disposeLateResponse(late, request.signal)));
			};
			const requestHandlerMiddleware = async ({ context }) => {
				return runWithStartContext({
					getRouter,
					startOptions: requestStartOptions,
					contextAfterGlobalMiddlewares: context,
					request,
					executedRequestMiddlewares,
					handlerType: "router"
				}, async () => {
					try {
						return await handleServerRoutes({
							getRouter,
							request,
							url,
							executeRouter,
							context,
							executedRequestMiddlewares
						});
					} catch (err) {
						if (err instanceof Response) return err;
						throw err;
					}
				});
			};
			const { response: middlewareResponse } = await executeMiddleware([...flattenedRequestMiddlewares.map((d) => d.options.server), requestHandlerMiddleware], {
				request,
				pathname: url.pathname,
				handlerType: "router",
				context: createNullProtoObject(requestOpts?.context)
			}, request.signal);
			const response = await handleRedirectResponse(middlewareResponse, request, getRouter, request.signal);
			bindSsrResponseToRequest(router ?? void 0, response, request.signal);
			request.signal.throwIfAborted();
			responseOwnsCleanup = response.serverSsrCleanup === "stream";
			return response.response;
		} finally {
			if (router?.serverSsr && !responseOwnsCleanup) router.serverSsr.cleanup();
			router = null;
		}
	};
	return requestHandler(startRequestResolver);
}
async function handleRedirectResponse(response, request, getRouter, signal) {
	signal.throwIfAborted();
	const ssrResponse = normalizeSsrResponse(response);
	if (!isRedirect(ssrResponse.response)) return ssrResponse;
	if (isResolvedRedirect(ssrResponse.response)) {
		if (request.headers.get("x-tsr-serverFn") === "true") return waitForRequest(replaceSsrResponse(ssrResponse, Response.json({
			...ssrResponse.response.options,
			isSerializedRedirect: true
		}, { headers: ssrResponse.response.headers }), "redirect response replaced"), signal);
		return ssrResponse;
	}
	const opts = ssrResponse.response.options;
	if (opts.to && typeof opts.to === "string" && !opts.to.startsWith("/")) throw new Error(`Server side redirects must use absolute paths via the 'href' or 'to' options. The redirect() method's "to" property accepts an internal path only. Use the "href" property to provide an external URL. Received: ${JSON.stringify(opts)}`);
	if ([
		"params",
		"search",
		"hash"
	].some((d) => typeof opts[d] === "function")) throw new Error(`Server side redirects must use static search, params, and hash values and do not support functional values. Received functional values for: ${Object.keys(opts).filter((d) => typeof opts[d] === "function").map((d) => `"${d}"`).join(", ")}`);
	signal.throwIfAborted();
	const router = await waitForRequest(getRouter(), signal);
	signal.throwIfAborted();
	const redirect = router.resolveRedirect(ssrResponse.response);
	if (request.headers.get("x-tsr-serverFn") === "true") return waitForRequest(replaceSsrResponse(ssrResponse, Response.json({
		...ssrResponse.response.options,
		isSerializedRedirect: true
	}, { headers: ssrResponse.response.headers }), "redirect response replaced"), signal);
	return waitForRequest(replaceSsrResponse(ssrResponse, redirect, "redirect response replaced"), signal);
}
async function handleServerRoutes({ getRouter, request, url, executeRouter, context, executedRequestMiddlewares }) {
	const router = await getRouter();
	const pathname = executeRewriteInput(router.rewrite, url).pathname;
	const [matchedRoutes, rawParams, foundRoute] = router.getMatchedRoutes(pathname);
	const isExactMatch = foundRoute && rawParams["**"] === void 0;
	const routeMiddlewares = [];
	for (const route of matchedRoutes) {
		const serverMiddleware = route.options.server?.middleware;
		if (serverMiddleware) {
			const flattened = flattenMiddlewares(serverMiddleware);
			for (const m of flattened) if (!executedRequestMiddlewares.has(m)) routeMiddlewares.push(m.options.server);
		}
	}
	const server = foundRoute?.options.server;
	let isHeadFallback = false;
	if (server?.handlers && isExactMatch) {
		const handlers = typeof server.handlers === "function" ? server.handlers({ createHandlers: (d) => d }) : server.handlers;
		const requestMethod = request.method.toUpperCase();
		const handler = requestMethod === "HEAD" ? handlers["HEAD"] ?? handlers["GET"] ?? handlers["ANY"] : handlers[requestMethod] ?? handlers["ANY"];
		isHeadFallback = requestMethod === "HEAD" && handler !== void 0 && !handlers["HEAD"];
		if (handler) {
			const mayDefer = !!foundRoute.options.component;
			if (typeof handler === "function") routeMiddlewares.push(handlerToMiddleware(handler, mayDefer));
			else {
				if (handler.middleware?.length) {
					const handlerMiddlewares = flattenMiddlewares(handler.middleware);
					for (const m of handlerMiddlewares) routeMiddlewares.push(m.options.server);
				}
				if (handler.handler) routeMiddlewares.push(handlerToMiddleware(handler.handler, mayDefer));
			}
		}
	}
	routeMiddlewares.push(((ctx) => executeRouter(ctx.context, matchedRoutes)));
	const { ctx, response } = await executeMiddleware(routeMiddlewares, {
		request,
		context,
		params: rawParams,
		pathname,
		handlerType: "router"
	}, request.signal);
	if (isHeadFallback) {
		if (!ctx.response) throwRouteHandlerError();
		return waitForRequest(stripSsrResponseBody(await handleRedirectResponse(response, request, getRouter, request.signal), "HEAD body stripped"), request.signal);
	}
	return normalizeSsrResponse(response);
}
var server_exports = /* @__PURE__ */ __exportAll$1({
	getRequest: () => getRequest,
	setCookie: () => setCookie$1
});
var fetch = createStartHandler(defaultStreamHandler);
function createServerEntry(entry) {
	return { async fetch(...args) {
		return await entry.fetch(...args);
	} };
}
var server_default = createServerEntry({ fetch });
//#endregion
export { getServerFnById as a, createServerEntry, server_default as default, TSS_SERVER_FUNCTION as i, createMiddleware as n, getRequest as o, createServerFn as r, ssr_exports as s, server_exports as t };
