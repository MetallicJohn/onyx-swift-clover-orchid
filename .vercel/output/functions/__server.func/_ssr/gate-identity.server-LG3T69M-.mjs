import { r as __exportAll } from "../_runtime.mjs";
import { t as __exportAll$1 } from "./rolldown-runtime-D7D4PA-g.mjs";
import { ht as jwtVerify, mt as importJWK } from "../_libs/@better-auth/core+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/gate-identity.server-LG3T69M-.js
var gate_identity_server_LG3T69M__exports = /* @__PURE__ */ __exportAll({
	a: () => gate_identity_server_exports,
	i: () => gateIdentityUserInfo,
	n: () => gateIdentityEnabled,
	o: () => sessionBoundToGateIdentity,
	r: () => gateIdentityFromHeaders,
	t: () => GATE_IDENTITY_HEADER
});
function env(key) {
	return process.env[key]?.trim() || void 0;
}
/**
* Workspace preview vs deployed app. The deployer writes GROK_PROJECT_ID on
* every publish; the sandbox preview never has it. Single source of truth for
* the split — gate audience, gate endpoints and connector-token semantics all
* key off this predicate.
*/
function isWorkspacePreview() {
	return !env("GROK_PROJECT_ID");
}
var gate_identity_server_exports = /* @__PURE__ */ __exportAll$1({
	GATE_IDENTITY_HEADER: () => GATE_IDENTITY_HEADER,
	GATE_JWKS_PATH: () => GATE_JWKS_PATH,
	PREVIEW_GATE_ORIGIN: () => PREVIEW_GATE_ORIGIN,
	gateIdentityEnabled: () => gateIdentityEnabled,
	gateIdentityFromHeaders: () => gateIdentityFromHeaders,
	gateIdentityUserInfo: () => gateIdentityUserInfo,
	gateKeyResolver: () => gateKeyResolver,
	gateTokenAudience: () => gateTokenAudience,
	resolveGateEndpoints: () => resolveGateEndpoints,
	sessionBoundToGateIdentity: () => sessionBoundToGateIdentity,
	verifyGateIdentityToken: () => verifyGateIdentityToken
});
var GATE_IDENTITY_HEADER = "x-grok-identity";
var GATE_JWKS_PATH = "/__gate/identity-key";
var JWKS_CACHE_TTL_MS = 3e5;
var PREVIEW_AUDIENCE = "preview";
var PREVIEW_GATE_ORIGIN = "http://127.0.0.1:6014";
var FALLBACK_EMAIL_DOMAIN = "viewer.grok.invalid";
var FALLBACK_NAME = "Grok user";
function gateIdentityEnabled() {
	return env("VITE_AUTH_ENABLED") !== "false";
}
function gateTokenAudience() {
	if (isWorkspacePreview()) return PREVIEW_AUDIENCE;
	return `app:${env("GROK_PROJECT_ID")}`;
}
async function defaultJwksFetch(url) {
	try {
		const res = await fetch(url, {
			headers: { accept: "application/json" },
			redirect: "manual"
		});
		if (!res.ok) return null;
		const body = await res.json();
		return Array.isArray(body?.keys) ? body : null;
	} catch {
		return null;
	}
}
var jwksCache = /* @__PURE__ */ new Map();
function gateKeyResolver(url, jwksFetch = defaultJwksFetch) {
	return async (protectedHeader) => {
		const kid = typeof protectedHeader.kid === "string" ? protectedHeader.kid : void 0;
		const findKey = (jwks) => jwks.keys.find((k) => k.kty === "OKP" && k.crv === "Ed25519" && (!kid || k.kid === kid));
		let entry = jwksCache.get(url);
		if (!entry || Date.now() - entry.fetchedAt > JWKS_CACHE_TTL_MS) {
			const jwks = await jwksFetch(url);
			if (jwks) {
				entry = {
					jwks,
					fetchedAt: Date.now()
				};
				jwksCache.set(url, entry);
			}
		}
		let key = entry ? findKey(entry.jwks) : void 0;
		if (!key) {
			const jwks = await jwksFetch(url);
			if (jwks) {
				entry = {
					jwks,
					fetchedAt: Date.now()
				};
				jwksCache.set(url, entry);
				key = findKey(jwks);
			}
		}
		if (!key) throw new Error("no gate identity key matches the token kid");
		return importJWK(key, "EdDSA");
	};
}
async function verifyGateIdentityToken(token, options) {
	try {
		const { payload } = await jwtVerify(token, options.getKey, {
			algorithms: ["EdDSA"],
			issuer: options.issuer,
			audience: options.audience,
			requiredClaims: [
				"sub",
				"iat",
				"exp"
			],
			maxTokenAge: "10 minutes"
		});
		const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
		if (!sub) return null;
		return {
			sub,
			email: typeof payload.email === "string" ? payload.email : null,
			name: typeof payload.name === "string" ? payload.name : null,
			teamId: typeof payload.team_id === "string" ? payload.team_id : null
		};
	} catch {
		return null;
	}
}
function resolveGateEndpoints(headers) {
	const explicit = env("GROK_GATE_ORIGIN");
	if (explicit) {
		const origin = explicit.replace(/\/+$/, "");
		return {
			issuer: origin,
			jwksUrl: `${origin}${GATE_JWKS_PATH}`
		};
	}
	if (isWorkspacePreview()) return {
		issuer: PREVIEW_GATE_ORIGIN,
		jwksUrl: `${PREVIEW_GATE_ORIGIN}${GATE_JWKS_PATH}`
	};
	const host = (headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host") || "").split(":")[0]?.trim().toLowerCase();
	if (!host) return null;
	let issuer = null;
	if (host === "app-builder-testing.com" || host.endsWith(".app-builder-testing.com")) issuer = "https://gate.app-builder-testing.com";
	else if (host === "grok.me" || host.endsWith(".grok.me")) issuer = "https://gate.grok.me";
	if (!issuer) return null;
	return {
		issuer,
		jwksUrl: `${issuer}${GATE_JWKS_PATH}`
	};
}
function sessionBoundToGateIdentity(accounts, identitySub, gateProviderId) {
	return accounts.some((account) => account.providerId === gateProviderId && account.accountId === identitySub);
}
async function gateIdentityFromHeaders(headers, jwksFetch) {
	if (!gateIdentityEnabled()) return null;
	const token = headers.get(GATE_IDENTITY_HEADER)?.trim();
	if (!token) return null;
	const endpoints = resolveGateEndpoints(headers);
	if (!endpoints) return null;
	return verifyGateIdentityToken(token, {
		issuer: endpoints.issuer,
		audience: gateTokenAudience(),
		getKey: gateKeyResolver(endpoints.jwksUrl, jwksFetch)
	});
}
function gateIdentityUserInfo(identity) {
	return {
		id: identity.sub,
		email: (identity.email ?? `${identity.sub}@${FALLBACK_EMAIL_DOMAIN}`).toLowerCase(),
		emailVerified: Boolean(identity.email),
		name: identity.name ?? FALLBACK_NAME
	};
}
//#endregion
export { gate_identity_server_LG3T69M__exports as a, gateIdentityUserInfo as i, gateIdentityEnabled as n, sessionBoundToGateIdentity as o, gateIdentityFromHeaders as r, GATE_IDENTITY_HEADER as t };
