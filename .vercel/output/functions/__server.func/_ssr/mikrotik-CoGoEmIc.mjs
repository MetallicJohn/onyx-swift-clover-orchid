import { M as nid, b as applyRls, l as ensureOpsSchema, r as commandRosScript, u as initialCommandStatus, v as wrapPullRosScript } from "./access-1saCIo2_.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/mikrotik-CoGoEmIc.js
function rate(payload) {
	return `${Number(payload.upload_mbps || payload.up || 10)}M/${Number(payload.download_mbps || payload.down || 10)}M`;
}
function nameOf(payload) {
	return String(payload.username || payload.name || "").trim();
}
function compileMikrotik(kind, payload) {
	const user = nameOf(payload);
	const password = String(payload.password || "changeme");
	const ip = String(payload.static_ip || payload.address || "");
	const profile = String(payload.package || payload.profile || "default");
	const limit = rate(payload);
	const disabled = payload.status === "suspended" || payload.status === "terminated" || payload.enabled === false;
	const script = commandRosScript(kind, payload);
	if (kind.startsWith("pppoe.")) {
		if (!user) return {
			rest: [],
			script
		};
		if (kind.endsWith("disconnect")) return {
			rest: [{
				method: "DELETE",
				path: `/rest/ppp/active/${encodeURIComponent(user)}`
			}],
			script
		};
		if (kind.endsWith("disable") || disabled) return {
			rest: [{
				method: "PATCH",
				path: `/rest/ppp/secret/${encodeURIComponent(user)}`,
				body: { disabled: "true" }
			}, {
				method: "DELETE",
				path: `/rest/ppp/active/${encodeURIComponent(user)}`
			}],
			script
		};
		return {
			rest: [{
				method: "PUT",
				path: "/rest/ppp/secret",
				body: {
					name: user,
					password,
					service: "pppoe",
					profile,
					disabled: "false",
					comment: String(payload.service_id || "gridline")
				}
			}],
			script
		};
	}
	if (kind.startsWith("static.")) {
		const qname = `static-${user || ip || "host"}`;
		if (kind.endsWith("disable") || disabled) return {
			rest: [{
				method: "PATCH",
				path: `/rest/queue/simple/${encodeURIComponent(qname)}`,
				body: { disabled: "true" }
			}, {
				method: "DELETE",
				path: `/rest/ip/firewall/address-list/${encodeURIComponent(ip)}`
			}],
			script
		};
		return {
			rest: [{
				method: "PUT",
				path: "/rest/queue/simple",
				body: {
					name: qname,
					target: `${ip}/32`,
					"max-limit": limit
				}
			}, {
				method: "PUT",
				path: "/rest/ip/firewall/address-list",
				body: {
					list: "gridline-active",
					address: ip,
					comment: user
				}
			}],
			script
		};
	}
	if (kind.startsWith("hotspot.")) {
		if (!user) return {
			rest: [],
			script
		};
		if (kind.endsWith("disconnect")) return {
			rest: [{
				method: "DELETE",
				path: `/rest/ip/hotspot/active/${encodeURIComponent(user)}`
			}],
			script
		};
		if (kind.endsWith("disable") || disabled) return {
			rest: [{
				method: "PATCH",
				path: `/rest/ip/hotspot/user/${encodeURIComponent(user)}`,
				body: { disabled: "true" }
			}],
			script
		};
		return {
			rest: [{
				method: "PUT",
				path: "/rest/ip/hotspot/user",
				body: {
					name: user,
					password,
					profile,
					disabled: "false"
				}
			}],
			script
		};
	}
	if (kind === "identity.set") return {
		rest: [{
			method: "POST",
			path: "/rest/system/identity/set",
			body: { name: String(payload.identity || payload.name || "gridline") }
		}],
		script
	};
	if (kind === "resource.snapshot") return {
		rest: [{
			method: "GET",
			path: "/rest/system/resource"
		}],
		script
	};
	if (kind === "raw.script") return {
		rest: [],
		script
	};
	if (kind === "reboot") return {
		rest: [{
			method: "POST",
			path: "/rest/system/reboot"
		}],
		script
	};
	return {
		rest: [],
		script
	};
}
function compileRow(id, kind, payloadRaw) {
	let payload = {};
	try {
		payload = JSON.parse(payloadRaw || "{}");
	} catch {
		payload = {};
	}
	const compiled = compileMikrotik(kind, payload);
	return {
		id,
		kind,
		rest: compiled.rest,
		script: compiled.script,
		payload
	};
}
async function routerByToken(sql, token) {
	const t = token.trim();
	if (!t) return null;
	await applyRls(sql, { bypass: true });
	const [r] = await sql`select id, tenant_id, name, identity, enroll_token, wg_address, api_user, api_password, api_port, api_host
     from routers where enroll_token = ${t}`;
	if (r) await applyRls(sql, {
		tenantId: r.tenant_id,
		bypass: false
	});
	return r ?? null;
}
async function pullCommands(sql, token, markSent = true) {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const router = await routerByToken(sql, token);
	if (!router) throw new Error("Unknown enroll token");
	await sql`update routers set wg_status = 'connected', last_seen = now() where id = ${router.id}`;
	const commands = (await sql`
    select id, kind, payload from agent_commands
    where router_id = ${router.id} and status = 'queued'
    order by created_at asc limit 40`).map((row) => compileRow(row.id, row.kind, row.payload));
	if (markSent) for (const c of commands) await sql`update agent_commands set status = 'sent' where id = ${c.id}`;
	return {
		router: {
			id: router.id,
			name: router.name,
			identity: router.identity,
			wg_address: router.wg_address
		},
		commands
	};
}
async function renderAgentScript(sql, token) {
	const pulled = await pullCommands(sql, token, true);
	return {
		script: wrapPullRosScript({
			identity: pulled.router.identity || pulled.router.name,
			commands: pulled.commands.map((c) => ({
				id: c.id,
				kind: c.kind,
				script: c.script
			}))
		}),
		ids: pulled.commands.map((c) => c.id).join(","),
		router: pulled.router
	};
}
async function ackCommands(sql, token, ids, result = "ok") {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const router = await routerByToken(sql, token);
	if (!router) throw new Error("Unknown enroll token");
	for (const id of ids) {
		if (!id) continue;
		await sql`update agent_commands set status = 'acked', acked_at = now(), result = ${result.slice(0, 2e3)}
      where id = ${id} and router_id = ${router.id}`;
	}
	return {
		ok: true,
		acked: ids.length
	};
}
async function heartbeatRouter(sql, token, stats) {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const router = await routerByToken(sql, token);
	if (!router) throw new Error("Unknown enroll token");
	await sql`update routers set
    wg_status = 'connected',
    last_seen = now(),
    cpu_pct = ${stats?.cpu ?? 8},
    uptime_hours = ${stats?.uptime_hours ?? 1},
    agent_version = ${stats?.version || "0.2.0"}
    where id = ${router.id}`;
	return {
		ok: true,
		router_id: router.id
	};
}
async function executeRestOps(host, user, password, port, ops) {
	const root = host.replace(/\/$/, "");
	const base = root.startsWith("http") ? root : `https://${root}:${port || 443}`;
	const auth = Buffer.from(`${user}:${password}`).toString("base64");
	const results = [];
	for (const op of ops) {
		const res = await fetch(`${base}${op.path}`, {
			method: op.method,
			headers: {
				Authorization: `Basic ${auth}`,
				"Content-Type": "application/json"
			},
			body: op.body ? JSON.stringify(op.body) : void 0
		});
		results.push({
			path: op.path,
			status: res.status,
			body: (await res.text()).slice(0, 400)
		});
	}
	return results;
}
function curlForOps(host, user, ops) {
	const base = host.replace(/\/$/, "") || "https://10.200.0.2";
	return ops.map((op) => {
		const body = op.body ? ` \\\n  --data '${JSON.stringify(op.body)}'` : "";
		return `curl -k -u ${user}:**** -X ${op.method} ${base}${op.path}${body}`;
	}).join("\n\n");
}
async function queueCompiledCommand(sql, tenantId, routerId, kind, payload, requestedBy = "") {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const id = nid("cmd");
	const status = initialCommandStatus(kind);
	await sql`insert into agent_commands (id, tenant_id, router_id, kind, payload, status, requested_by)
    values (${id}, ${tenantId}, ${routerId}, ${kind}, ${JSON.stringify(payload)}, ${status}, ${requestedBy})`;
	return {
		id,
		status,
		...compileMikrotik(kind, payload)
	};
}
async function approveCommand(sql, tenantId, commandId, userId) {
	const [cmd] = await sql`
    select id, status, kind from agent_commands where id = ${commandId} and tenant_id = ${tenantId}`;
	if (!cmd) throw new Error("Command not found");
	if (cmd.status !== "proposed") throw new Error("Only proposed commands can be approved");
	await sql`update agent_commands set status = 'queued', approved_by = ${userId}
    where id = ${cmd.id} and tenant_id = ${tenantId}`;
	await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${`command.approved:${cmd.kind}`}, 'agent_command', ${cmd.id})`;
	return {
		ok: true,
		id: cmd.id
	};
}
//#endregion
export { curlForOps as a, pullCommands as c, compileRow as i, queueCompiledCommand as l, approveCommand as n, executeRestOps as o, compileMikrotik as r, heartbeatRouter as s, ackCommands as t, renderAgentScript as u };
