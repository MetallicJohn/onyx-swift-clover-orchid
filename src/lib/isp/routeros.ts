/** RouterOS v7 script generation. Enroll scripts inline values so /import works. */
/* eslint-disable no-useless-escape -- RouterOS uses $locals; JS templates must emit a literal dollar */
import { APP_NAME, APP_SLUG, ROS_ACTIVE_LIST, ROS_AGENT_POLICY, ROS_AGENT_SCHEDULER, ROS_API_PORT, ROS_API_USER, ROS_ENROLL_FILE, ROS_PULL_FILE, ROS_PULL_SCRIPT, ROS_USER_COMMENT, ROS_WG_INTERFACE, ROS_WG_INTERFACE_LEGACY } from "../brand.ts";
import { WG_HUB_ALLOWED } from "./wg-endpoint.ts";
import { pcqFromPayload } from "./pcq.ts";

export function rosQuote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** RouterOS-safe username derived from the overlay IPv4 (10.200.0.4 → 10200004). */
export function rosOverlayUserName(wgAddress: string) {
  const host = String(wgAddress || "").trim().replace(/\/\d+$/, "");
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return "";
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => n < 0 || n > 255)) return "";
  return `${octets[0]}${octets[1]}${octets[2]}${String(octets[3]).padStart(2, "0")}`;
}

export type RosConnectionOpts = {
  name: string;
  identity: string;
  token: string;
  wgPublic: string;
  wgAddress: string;
  pullUrl?: string;
  wgPrivate?: string;
  serverPublic?: string;
  endpointHost?: string;
  endpointPort?: number;
  serverAddress?: string;
  apiUser?: string;
  apiPassword?: string;
  routerId?: string;
};

export type RosConnectionKind = "enroll" | "repair" | "wireguard-rotate" | "api-rotate" | "agent";

function fetchHostname(url: string) {
  try {
    return new URL(url).hostname || "ispsolutions.co.ke";
  } catch {
    return "ispsolutions.co.ke";
  }
}

function rosEnsureUser(opts: { name: string; password: string; group: string; comment: string }) {
  const name = rosQuote(opts.name);
  const password = rosQuote(opts.password);
  const group = rosQuote(opts.group);
  const comment = rosQuote(opts.comment);
  return `:if ([:len [/user find where name=${name}]] = 0) do={
  :do { /user add name=${name} password=${password} group=${group} address=10.200.0.1/32 comment=${comment} } on-error={ :log error ${rosQuote(`${APP_NAME}: user ${opts.name} failed`)} }
} else={
  :do { /user set [find where name=${name}] password=${password} group=${group} address=10.200.0.1/32 comment=${comment} } on-error={
    :do { /user set [find where name=${name}] password=${password} } on-error={ :log error ${rosQuote(`${APP_NAME}: user ${opts.name} failed`)} }
  }
}`;
}

/**
 * Capture /tool fetch as-value. FINISHED + a file is success — never report HTTPS fetch failed after that.
 * ftp policy is required on the scheduled script that runs this.
 */
export function rosHttpsFetchBlock(url: string, fileName: string, kind: "agent" | "bootstrap") {
  const prefix = kind === "agent" ? `${APP_NAME} agent` : APP_NAME;
  const quotedUrl = rosQuote(url);
  const qRoot = rosQuote(fileName);
  const qFlash = rosQuote(`flash/${fileName}`);
  const host = fetchHostname(url);
  const logInfoFetch = rosQuote(`${prefix}: fetching configuration`);
  const logDns = rosQuote(`${prefix}: DNS/connection error`);
  const logHttps = rosQuote(`${prefix}: HTTPS request failed`);
  const log401 = rosQuote(`${prefix}: HTTP 401 Unauthorized`);
  const log403 = rosQuote(`${prefix}: HTTP 403 Forbidden`);
  const log404 = rosQuote(`${prefix}: HTTP 404 Not Found`);
  const log500 = rosQuote(`${prefix}: HTTP 500 Server Error`);
  const logHttp = rosQuote(`${prefix}: HTTP request failed code=`);
  const logMissing = rosQuote(`${prefix}: download finished but file missing`);
  const logEmpty = rosQuote(`${prefix}: downloaded file is empty`);
  const logImportFail = rosQuote(`${prefix}: configuration import failed`);
  const logImportOk = rosQuote(`${prefix}: configuration imported successfully`);
  const logStatus = rosQuote(`${prefix}: HTTPS fetch failed status=`);
  const logFinished = rosQuote(`Download from ${host} FINISHED`);
  return `:local ispSolResult;
:do { /file remove [find where name=${qRoot}] } on-error={}
:do { /file remove [find where name=${qFlash}] } on-error={}
:log info ${logInfoFetch};
:do {
  :set ispSolResult [/tool fetch url=${quotedUrl} mode=https check-certificate=no http-method=get output=file dst-path=${qRoot} as-value];
} on-error={
  :do {
    :set ispSolResult [/tool fetch url=${quotedUrl} mode=https check-certificate=no http-method=get output=file dst-path=${qFlash} as-value];
  } on-error={}
}
:local ispSolStatus ($ispSolResult->"status");
:local ispSolCode ($ispSolResult->"code");
:local ispSolBytes ($ispSolResult->"downloaded");
:if ([:typeof $ispSolStatus] = "nil") do={ :set ispSolStatus "" };
:if ([:typeof $ispSolCode] = "nil") do={ :set ispSolCode 0 };
:if ([:typeof $ispSolBytes] = "nil") do={ :set ispSolBytes 0 };
:local ispSolFile ${qRoot};
:if ([:len [/file find where name=${qRoot}]] = 0) do={
  :if ([:len [/file find where name=${qFlash}]] > 0) do={ :set ispSolFile ${qFlash} };
}
:local ispSolHaveFile ([:len [/file find where name=$ispSolFile]] > 0);
:if (($ispSolStatus = "failed") && ($ispSolHaveFile != true)) do={
  :log warning ${logHttps};
} else={
:if (($ispSolStatus != "finished") && ($ispSolStatus != "") && ($ispSolHaveFile != true)) do={
  :log warning (${logStatus} . $ispSolStatus);
} else={
:if (($ispSolHaveFile != true) && ($ispSolStatus = "")) do={
  :log warning ${logDns};
} else={
:if (($ispSolCode = 401) || ($ispSolCode = 403) || ($ispSolCode = 404) || ($ispSolCode = 500) || ($ispSolCode >= 400)) do={
  :if ($ispSolCode = 401) do={ :log warning ${log401} };
  :if ($ispSolCode = 403) do={ :log warning ${log403} };
  :if ($ispSolCode = 404) do={ :log warning ${log404} };
  :if ($ispSolCode = 500) do={ :log warning ${log500} };
  :if (($ispSolCode != 401) && ($ispSolCode != 403) && ($ispSolCode != 404) && ($ispSolCode != 500)) do={ :log warning (${logHttp} . $ispSolCode) };
  :do { /file remove [find where name=$ispSolFile] } on-error={}
} else={
  :if ($ispSolHaveFile != true) do={
    :log warning ${logMissing};
  } else={
    :local ispSolSize [/file get [find where name=$ispSolFile] size];
    :if (($ispSolSize <= 0) && ($ispSolBytes <= 0)) do={
      :log warning ${logEmpty};
      :do { /file remove [find where name=$ispSolFile] } on-error={}
    } else={
      :log info ${logFinished};
      :local ispSolHttp $ispSolCode;
      :if (($ispSolHttp = 0) || ($ispSolHttp = "")) do={ :set ispSolHttp 200 };
      :log info ("${prefix}: HTTP " . $ispSolHttp);
      :log info ("${prefix}: downloaded " . $ispSolSize . " bytes");
      :do {
        /import file-name=$ispSolFile;
        :log info ${logImportOk};
      } on-error={
        :log warning ${logImportFail};
      }
      :do { /file remove [find where name=$ispSolFile] } on-error={}
    }
  }
}
}
}
}`;
}

export function rosFetchFile(url: string, fileName: string) {
  return rosHttpsFetchBlock(url, fileName, "bootstrap");
}

function localBlock(vars: Record<string, string>) {
  return Object.entries(vars)
    .map(([k, v]) => `:local ${k} ${rosQuote(v)};`)
    .join("\n");
}

function normalizedAddr(wgAddress: string) {
  return wgAddress.includes("/") ? wgAddress : `${wgAddress}/32`;
}

function connectionParts(opts: RosConnectionOpts) {
  const identity = opts.identity || opts.name;
  const addr = normalizedAddr(opts.wgAddress);
  const pull = opts.pullUrl || "";
  const peerKey = opts.serverPublic || opts.wgPublic;
  const endpointHost = (opts.endpointHost || "").trim();
  const endpointPort = opts.endpointPort || 51820;
  const hubIp = opts.serverAddress || "10.200.0.1";
  const allowed = WG_HUB_ALLOWED;
  const wgPriv = rosQuote(opts.wgPrivate || "");
  const peerPub = rosQuote(peerKey);
  const apiUser = opts.apiUser?.trim() || rosOverlayUserName(addr) || ROS_API_USER;
  const apiPass = opts.apiPassword || "";
  const overlayUser = rosOverlayUserName(addr);
  return {
    identity,
    addr,
    pull,
    peerKey,
    endpointHost,
    endpointPort,
    hubIp,
    allowed,
    wgPriv,
    peerPub,
    apiUser,
    apiPass,
    overlayUser,
    routerId: opts.routerId || identity,
  };
}

function rosIdentityBlock(identity: string) {
  return `:do { /system identity set name=${rosQuote(identity)} } on-error={ :log error ${rosQuote(`${APP_NAME}: identity failed`)} }`;
}

function rosWireGuardInterfaceBlock(wgPriv: string) {
  return `:if ([:len [/interface wireguard find where name="${ROS_WG_INTERFACE}"]] = 0) do={
  :do { /interface wireguard set [find where name="${ROS_WG_INTERFACE_LEGACY}"] name=${ROS_WG_INTERFACE} } on-error={}
}
:if ([:len [/interface wireguard find where name="${ROS_WG_INTERFACE}"]] = 0) do={
  :do { /interface wireguard add name=${ROS_WG_INTERFACE} listen-port=13231 private-key=${wgPriv} comment=${rosQuote(APP_NAME)} } on-error={ :log error ${rosQuote(`${APP_NAME}: WireGuard interface failed — need RouterOS v7`)} }
} else={
  :do { /interface wireguard set [find where name="${ROS_WG_INTERFACE}"] private-key=${wgPriv} listen-port=13231 comment=${rosQuote(APP_NAME)} } on-error={ :log error ${rosQuote(`${APP_NAME}: WireGuard interface failed — need RouterOS v7`)} }
}
:do { /ip firewall filter set [find where in-interface="${ROS_WG_INTERFACE_LEGACY}"] in-interface=${ROS_WG_INTERFACE} } on-error={}
:do { /ip address set [find where interface="${ROS_WG_INTERFACE_LEGACY}"] interface=${ROS_WG_INTERFACE} } on-error={}
:do { /ip route set [find where gateway="${ROS_WG_INTERFACE_LEGACY}"] gateway=${ROS_WG_INTERFACE} } on-error={}
:do { /interface wireguard peers set [find where interface="${ROS_WG_INTERFACE_LEGACY}"] interface=${ROS_WG_INTERFACE} } on-error={}
:do { /interface wireguard remove [find where name="${ROS_WG_INTERFACE_LEGACY}"] } on-error={}`;
}

function rosWireGuardPeerBlock(opts: {
  peerPub: string;
  allowed: string;
  endpointHost: string;
  endpointPort: number;
}) {
  const endpoint = opts.endpointHost
    ? `:do { /interface wireguard peers set [find where public-key=${opts.peerPub}] endpoint-address=${rosQuote(opts.endpointHost)} endpoint-port=${opts.endpointPort} } on-error={ :log warning ${rosQuote(`${APP_NAME}: peer endpoint not set — check DNS for ${opts.endpointHost}`)} }`
    : "";
  return `:if ([:len [/interface wireguard peers find where public-key=${opts.peerPub}]] = 0) do={
  :do { /interface wireguard peers add interface=${ROS_WG_INTERFACE} public-key=${opts.peerPub} allowed-address=${rosQuote(opts.allowed)} comment=${rosQuote(`${APP_NAME} controller`)} } on-error={ :log error ${rosQuote(`${APP_NAME}: WireGuard peer failed`)} }
} else={
  :do { /interface wireguard peers set [find where public-key=${opts.peerPub}] interface=${ROS_WG_INTERFACE} public-key=${opts.peerPub} allowed-address=${rosQuote(opts.allowed)} comment=${rosQuote(`${APP_NAME} controller`)} } on-error={ :log error ${rosQuote(`${APP_NAME}: WireGuard peer failed`)} }
}
:do { /interface wireguard peers set [find where public-key=${opts.peerPub}] persistent-keepalive=25s } on-error={
  :do { /interface wireguard peers set [find where public-key=${opts.peerPub}] persistent-keepalive=00:00:25 } on-error={}
}
${endpoint}`;
}

function rosOverlayAddressBlock(addr: string) {
  return `:if ([:len [/ip address find where interface="${ROS_WG_INTERFACE}" and address=${rosQuote(addr)}]] = 0) do={
  :foreach a in=[/ip address find where interface="${ROS_WG_INTERFACE}"] do={
    :do { /ip address remove \$a } on-error={}
  }
  :do { /ip address add address=${rosQuote(addr)} interface=${ROS_WG_INTERFACE} } on-error={ :log error ${rosQuote(`${APP_NAME}: overlay address failed`)} }
}`;
}

function rosApiFirewallBlock(hubIp: string) {
  return `:do { /ip firewall filter remove [find where comment="gridline-agent" or comment=${rosQuote(`${APP_NAME} agent`)}] } on-error={}
:if ([:len [/ip firewall filter find where comment=${rosQuote(`${APP_NAME} api`)}]] = 0) do={
  :do { /ip firewall filter add chain=input in-interface=${ROS_WG_INTERFACE} protocol=tcp dst-port=${ROS_API_PORT} src-address=${hubIp} action=accept comment=${rosQuote(`${APP_NAME} api`)} place-before=0 } on-error={ :log error ${rosQuote(`${APP_NAME}: API firewall rule failed`)} }
} else={
  :do { /ip firewall filter set [find where comment=${rosQuote(`${APP_NAME} api`)}] in-interface=${ROS_WG_INTERFACE} protocol=tcp dst-port=${ROS_API_PORT} src-address=${hubIp} action=accept } on-error={}
}

:do { /ip service set api disabled=no port=${ROS_API_PORT} address=${hubIp}/32 } on-error={ :log error ${rosQuote(`${APP_NAME}: API service failed`)} }
:do { /ip service set api-ssl disabled=yes } on-error={}`;
}

function rosApiUserBlock(opts: { apiUser: string; apiPass: string; overlayUser: string }) {
  if (!opts.apiPass) return "";
  const users = new Set<string>();
  if (opts.overlayUser) users.add(opts.overlayUser);
  if (opts.apiUser) users.add(opts.apiUser);
  return [...users]
    .map((name) => rosEnsureUser({ name, password: opts.apiPass, group: "full", comment: ROS_USER_COMMENT }))
    .join("\n");
}

function rosAgentBlock(pull: string) {
  if (pull) {
    return `
:do { /system script remove [find where name="gridline-pull"] } on-error={}
:do { /system script remove [find where name=${rosQuote(ROS_PULL_SCRIPT)}] } on-error={}
/system script add name=${rosQuote(ROS_PULL_SCRIPT)} policy=${ROS_AGENT_POLICY} source={
  :global ispSolLock;
  :if (\$ispSolLock = true) do={
    :log warning ${rosQuote(`${APP_NAME} agent already running`)};
    :return;
  }
  :set ispSolLock true;
  :do {
    ${rosHttpsFetchBlock(pull, ROS_PULL_FILE, "agent").split("\n").join("\n    ")}
  } on-error={
    :log warning ${rosQuote(`${APP_NAME} agent: unexpected execution error`)};
  }
  :set ispSolLock false;
}

:do { /system scheduler remove [find where name="gridline-agent"] } on-error={}
:do { /system scheduler remove [find where name=${rosQuote(ROS_AGENT_SCHEDULER)}] } on-error={}
/system scheduler add name=${rosQuote(ROS_AGENT_SCHEDULER)} interval=1m start-time=startup policy=${ROS_AGENT_POLICY} on-event="/system script run ${ROS_PULL_SCRIPT}";`;
  }
  return `
:do { /system scheduler remove [find where name="gridline-agent"] } on-error={}
:do { /system scheduler remove [find where name=${rosQuote(ROS_AGENT_SCHEDULER)}] } on-error={}
/system scheduler add name=${rosQuote(ROS_AGENT_SCHEDULER)} interval=1m start-time=startup on-event={ :log info ${rosQuote(`${APP_NAME} agent waiting for pull URL`)} };`;
}

function rosHeader(kind: RosConnectionKind, parts: ReturnType<typeof connectionParts>) {
  const titles: Record<RosConnectionKind, string> = {
    enroll: "Enrollment",
    repair: "Repair",
    "wireguard-rotate": "WireGuard rotation",
    "api-rotate": "API credential rotation",
    agent: "Agent",
  };
  const missingEndpoint =
    parts.endpointHost || kind === "api-rotate" || kind === "agent"
      ? ""
      : `# No hub endpoint saved — the router cannot start the handshake.
# Settings → Network: set the VPS public hostname or IP, then copy this script again.
`;
  return `# ${APP_NAME} RouterOS v7 ${titles[kind]}
# Router: ${parts.identity}
# Router ID: ${parts.routerId}
# Overlay: ${parts.addr} → hub ${parts.hubIp} (UDP ${parts.endpointPort})
# IMPORTANT:
# - No MikroTik CA certificate required
# - HTTPS uses check-certificate=no
# - RouterOS API is accessible only through WireGuard
# Paste in New Terminal, or: /import file-name=${ROS_ENROLL_FILE}
${missingEndpoint}`;
}

function renderRosConnectionScript(opts: RosConnectionOpts, kind: RosConnectionKind) {
  const parts = connectionParts(opts);
  const includeWg = kind === "enroll" || kind === "repair" || kind === "wireguard-rotate";
  const includeApi = kind === "enroll" || kind === "repair" || kind === "api-rotate";
  const includeAgent = kind === "enroll" || kind === "repair" || kind === "agent";
  const includeIdentity = kind !== "api-rotate" && kind !== "agent";
  const chunks = [rosHeader(kind, parts)];
  if (includeIdentity) chunks.push(rosIdentityBlock(parts.identity));
  if (includeWg) {
    chunks.push(rosWireGuardInterfaceBlock(parts.wgPriv));
    chunks.push(
      rosWireGuardPeerBlock({
        peerPub: parts.peerPub,
        allowed: parts.allowed,
        endpointHost: parts.endpointHost,
        endpointPort: parts.endpointPort,
      }),
    );
    chunks.push(rosOverlayAddressBlock(parts.addr));
  }
  if (includeApi) {
    chunks.push(rosApiFirewallBlock(parts.hubIp));
    chunks.push(rosApiUserBlock({ apiUser: parts.apiUser, apiPass: parts.apiPass, overlayUser: parts.overlayUser }));
  }
  if (kind === "enroll" || kind === "repair") {
    chunks.push(`:log info ("${APP_NAME} enrollment initialized router=" . ${rosQuote(parts.routerId)});`);
  }
  if (includeAgent) chunks.push(rosAgentBlock(parts.pull));
  return chunks.filter(Boolean).join("\n") + "\n";
}

export function generateNewRouterEnrollmentScript(opts: RosConnectionOpts) {
  return renderRosConnectionScript(opts, "enroll");
}

export function generateExistingRouterRepairScript(opts: RosConnectionOpts) {
  return renderRosConnectionScript(opts, "repair");
}

export function generateWireGuardRotationScript(opts: RosConnectionOpts) {
  return renderRosConnectionScript(opts, "wireguard-rotate");
}

export function generateApiCredentialRotationScript(opts: RosConnectionOpts) {
  return renderRosConnectionScript(opts, "api-rotate");
}

export function generateAgentScript(opts: RosConnectionOpts) {
  return renderRosConnectionScript(opts, "agent");
}

export function enrollRosScript(opts: RosConnectionOpts) {
  return generateNewRouterEnrollmentScript(opts);
}

export function apiUserEnsureRos(opts: { user?: string; password: string; wgAddress?: string }) {
  const overlay = rosOverlayUserName(opts.wgAddress || "");
  const user = opts.user?.trim() || overlay || ROS_API_USER;
  const password = opts.password || "";
  if (!password) return "";
  const names = new Set<string>([user]);
  if (overlay) names.add(overlay);
  const users = [...names]
    .map((name) => rosEnsureUser({ name, password, group: "full", comment: ROS_USER_COMMENT }))
    .join("\n");
  return `# ${APP_NAME} API user — RouterOS v7
${users}
:do { /ip service set api disabled=no port=${ROS_API_PORT} address=10.200.0.1/32 } on-error={}
:do { /ip service set api-ssl disabled=yes } on-error={}
:log info ${rosQuote(`${APP_NAME} API user ready`)};
`;
}

function pcqEnsureRos(payload: Record<string, unknown>) {
  const p = pcqFromPayload(payload);
  return `${localBlock({
    profile: p.profile,
    upType: p.upType,
    downType: p.downType,
    upRate: p.upRate,
    downRate: p.downRate,
    list: p.list,
    markUp: p.markUp,
    markDown: p.markDown,
    treeUp: p.treeUp,
    treeDown: p.treeDown,
    cmtUp: p.commentUp,
    cmtDown: p.commentDown,
  })}
:if ([:len [/queue type find where name=\$upType]] = 0) do={
  /queue type add name=\$upType kind=pcq pcq-rate=\$upRate pcq-classifier=src-address pcq-limit=50 pcq-total-limit=20000;
} else={
  /queue type set [find where name=\$upType] kind=pcq pcq-rate=\$upRate pcq-classifier=src-address pcq-limit=50 pcq-total-limit=20000;
}
:if ([:len [/queue type find where name=\$downType]] = 0) do={
  /queue type add name=\$downType kind=pcq pcq-rate=\$downRate pcq-classifier=dst-address pcq-limit=50 pcq-total-limit=20000;
} else={
  /queue type set [find where name=\$downType] kind=pcq pcq-rate=\$downRate pcq-classifier=dst-address pcq-limit=50 pcq-total-limit=20000;
}
:local qspec (\$upType . "/" . \$downType);
:if ([:len [/ppp profile find where name=\$profile]] = 0) do={
  /ppp profile add name=\$profile queue=\$qspec comment="isp-pcq";
} else={
  /ppp profile set [find where name=\$profile] queue=\$qspec;
}
:if ([:len [/ip hotspot user profile find where name=\$profile]] = 0) do={
  /ip hotspot user profile add name=\$profile address-list=\$list rate-limit="" comment="isp-pcq";
} else={
  /ip hotspot user profile set [find where name=\$profile] address-list=\$list rate-limit="";
}
:if ([:len [/ip firewall mangle find where comment=\$cmtUp]] = 0) do={
  /ip firewall mangle add chain=forward action=mark-packet new-packet-mark=\$markUp passthrough=no src-address-list=\$list comment=\$cmtUp;
} else={
  /ip firewall mangle set [find where comment=\$cmtUp] src-address-list=\$list new-packet-mark=\$markUp passthrough=no;
}
:if ([:len [/ip firewall mangle find where comment=\$cmtDown]] = 0) do={
  /ip firewall mangle add chain=forward action=mark-packet new-packet-mark=\$markDown passthrough=no dst-address-list=\$list comment=\$cmtDown;
} else={
  /ip firewall mangle set [find where comment=\$cmtDown] dst-address-list=\$list new-packet-mark=\$markDown passthrough=no;
}
:if ([:len [/queue tree find where name=\$treeUp]] = 0) do={
  /queue tree add name=\$treeUp parent=global queue=\$upType packet-mark=\$markUp comment="isp-pcq";
} else={
  /queue tree set [find where name=\$treeUp] queue=\$upType packet-mark=\$markUp parent=global;
}
:if ([:len [/queue tree find where name=\$treeDown]] = 0) do={
  /queue tree add name=\$treeDown parent=global queue=\$downType packet-mark=\$markDown comment="isp-pcq";
} else={
  /queue tree set [find where name=\$treeDown] queue=\$downType packet-mark=\$markDown parent=global;
}`;
}

export type RosPool = { name: string; ranges: string };

export function poolPushRosScript(pools: RosPool[]) {
  if (!pools.length) {
    return `# ${APP_NAME} — no IP pools assigned`;
  }
  return pools
    .map((p, i) => {
      const nameVar = `pool${i}Name`;
      const rangeVar = `pool${i}Ranges`;
      return `${localBlock({ [nameVar]: p.name, [rangeVar]: p.ranges })}
:if ([:len [/ip pool find where name=$${nameVar}]] = 0) do={
  /ip pool add name=$${nameVar} ranges=$${rangeVar} comment=${rosQuote(`${APP_NAME} pool`)};
} else={
  /ip pool set [find where name=$${nameVar}] ranges=$${rangeVar} comment=${rosQuote(`${APP_NAME} pool`)};
}`;
    })
    .join("\n");
}

export function commandRosScript(kind: string, payload: Record<string, unknown>) {
  const user = String(payload.username || payload.name || "").trim();
  const password = String(payload.password || "");
  const ip = String(payload.static_ip || payload.address || "");
  const list = pcqFromPayload(payload).list;
  const comment = String(payload.service_id || APP_SLUG);
  const disabled = payload.status === "suspended" || payload.status === "terminated" || payload.enabled === false;
  const qname = String(payload.qname || `static-${user || ip || "host"}`);

  if (kind === "package.sync") {
    return pcqEnsureRos(payload);
  }

  if (kind === "pool.push") {
    const pools = Array.isArray(payload.pools)
      ? (payload.pools as RosPool[]).filter((p) => p && p.name && p.ranges)
      : [];
    return poolPushRosScript(pools);
  }

  if (kind.startsWith("queue.")) {
    const target = ip.includes("/") ? ip : ip ? `${ip}/32` : "";
    const up = String(payload.upload_mbps || payload.up || 10);
    const down = String(payload.download_mbps || payload.down || 10);
    const maxLimit = `${up}M/${down}M`;
    if (!target) return "# missing queue target";
    if (kind.endsWith("remove") || disabled) {
      return `${localBlock({ qname, ip: target })}
:do { /queue simple remove [find where name=\$qname] } on-error={};
:do { /queue simple remove [find where target=\$ip] } on-error={};`;
    }
    return `${localBlock({ qname, ip: target, maxLimit, user })}
:if ([:len [/queue simple find where name=\$qname]] = 0) do={
  /queue simple add name=\$qname target=\$ip max-limit=\$maxLimit comment=\$user;
} else={
  /queue simple set [find where name=\$qname] target=\$ip max-limit=\$maxLimit comment=\$user;
}`;
  }

  if (kind.startsWith("pppoe.")) {
    if (!user) return "# missing pppoe username";
    if (kind.endsWith("disconnect")) {
      return `${localBlock({ user })}
:do { /ppp active remove [find where name=\$user] } on-error={};`;
    }
    if (kind.endsWith("disable") || disabled) {
      return `${localBlock({ user })}
:if ([:len [/ppp secret find where name=\$user]] > 0) do={
  /ppp secret set [find where name=\$user] disabled=yes;
}
:do { /ppp active remove [find where name=\$user] } on-error={};`;
    }
    return `${pcqEnsureRos(payload)}

${localBlock({ user, pass: password, comment })}
:if ([:len [/ppp secret find where name=\$user]] = 0) do={
  /ppp secret add name=\$user password=\$pass service=pppoe profile=\$profile comment=\$comment disabled=no;
} else={
  /ppp secret set [find where name=\$user] password=\$pass profile=\$profile disabled=no;
}`;
  }

  if (kind.startsWith("static.")) {
    if (kind.endsWith("disable") || disabled) {
      return `${localBlock({ qname, ip, list, user })}
:do { /queue simple remove [find where name=\$qname] } on-error={};
:do { /ip firewall address-list remove [find where list=\$list and address=\$ip] } on-error={};
:do { /ip firewall address-list remove [find where list="gridline-active" and address=\$ip] } on-error={};
:do { /ip firewall address-list remove [find where list=${rosQuote(ROS_ACTIVE_LIST)} and address=\$ip] } on-error={};`;
    }
    return `${pcqEnsureRos(payload)}

${localBlock({ qname, ip, user })}
:do { /queue simple remove [find where name=\$qname] } on-error={};
:do { /ip firewall address-list remove [find where address=\$ip and list~"^isp-"] } on-error={};
:if ([:len [/ip firewall address-list find where list=\$list and address=\$ip]] = 0) do={
  /ip firewall address-list add list=\$list address=\$ip comment=\$user;
}
:do { /ip firewall address-list remove [find where list="gridline-active" and address=\$ip] } on-error={};
:if ([:len [/ip firewall address-list find where list=${rosQuote(ROS_ACTIVE_LIST)} and address=\$ip]] = 0) do={
  /ip firewall address-list add list=${rosQuote(ROS_ACTIVE_LIST)} address=\$ip comment=\$user;
}`;
  }

  if (kind === "hotspot.portal.deploy") {
    const base = String(payload.html_base || "").replace(/\/$/, "");
    const token = String(payload.token || "");
    const dstRaw = String(payload.dst_dir || "hotspot").replace(/[^A-Za-z0-9/_-]/g, "");
    const dst = dstRaw || "hotspot";
    const allow = new Set(["login.html", "alogin.html", "status.html", "logout.html", "error.html", "md5.js"]);
    const files = (Array.isArray(payload.files) ? payload.files.map(String) : [...allow]).filter((f) => allow.has(f));
    const verifyOk = String(payload.verify_ok || "");
    const verifyFail = String(payload.verify_fail || "");
    if (!base || !token || files.length === 0) return "# missing hotspot portal url";
    const fileArray = files.map((f) => rosQuote(f)).join(";");
    return `${localBlock({ base, tok: token, dst, verifyOk, verifyFail })}
:local missing 0;
:local files {${fileArray}};
:do { /ip hotspot profile set [find] html-directory=$dst } on-error={};
:foreach f in=$files do={
  :local url ($base . "/" . $f . "?token=" . $tok);
  :local path ($dst . "/" . $f);
  :do { /tool fetch url=$url dst-path=$path } on-error={ :set missing ($missing + 1) };
};
:foreach f in=$files do={
  :local path ($dst . "/" . $f);
  :if ([:len [/file find name=$path]] = 0) do={
    :if ([:len [/file find name=$f]] = 0) do={
      :set missing ($missing + 1);
    }
  }
};
:if ($missing = 0) do={
  :if ([:len $verifyOk] > 0) do={
    :do { /tool fetch url=$verifyOk keep-result=no } on-error={};
  }
  :put "portal ok";
} else={
  :if ([:len $verifyFail] > 0) do={
    :do { /tool fetch url=$verifyFail keep-result=no } on-error={};
  }
  :error "hotspot-portal missing files";
}`;
  }

  if (kind.startsWith("hotspot.")) {
    if (!user) return "# missing hotspot username";
    if (kind.endsWith("disconnect")) {
      return `${localBlock({ user })}
:do { /ip hotspot active remove [find where user=\$user] } on-error={};`;
    }
    if (kind.endsWith("disable") || disabled) {
      return `${localBlock({ user })}
:if ([:len [/ip hotspot user find where name=\$user]] > 0) do={
  /ip hotspot user set [find where name=\$user] disabled=yes;
}
:do { /ip hotspot active remove [find where user=\$user] } on-error={};`;
    }
    return `${pcqEnsureRos(payload)}

${localBlock({ user, pass: password })}
:if ([:len [/ip hotspot user find where name=\$user]] = 0) do={
  /ip hotspot user add name=\$user password=\$pass profile=\$profile disabled=no;
} else={
  /ip hotspot user set [find where name=\$user] password=\$pass profile=\$profile disabled=no;
}`;
  }

  if (kind === "identity.set") {
    const identity = String(payload.identity || payload.name || APP_NAME);
    return `${localBlock({ identity })}
/system identity set name=\$identity;`;
  }

  if (kind === "resource.snapshot") {
    return `:log info [/system resource get version];
:log info [/system resource get cpu-load];`;
  }

  if (kind === "raw.script") {
    return String(payload.script || payload.source || "");
  }

  if (kind === "reboot") {
    return `:delay 2s;
/system reboot;`;
  }

  return `# unknown kind ${kind}`;
}

export function wrapPullRosScript(opts: {
  identity: string;
  commands: { id: string; kind: string; script: string }[];
}) {
  const body = opts.commands
    .map((c) => {
      const inner = c.script
        .split("\n")
        .map((line) => (line.length ? `  ${line}` : line))
        .join("\n");
      return `# --- ${c.kind} ${c.id}
:do {
${inner}
} on-error={
  :log error ${rosQuote(`${APP_NAME} command ${c.id} failed`)};
}`;
    })
    .join("\n\n");
  return `# ${APP_NAME} agent pull — RouterOS v7
# /import file-name=${ROS_PULL_FILE}
# identity: ${opts.identity}

{
${body || `  :log info ${rosQuote(`${APP_NAME} agent idle`)};`}

  :log info ${rosQuote(`${APP_NAME} agent applied ${opts.commands.length} command(s)`)};
}
`;
}
