/** RouterOS v7 script generation. Uses :local, :if, :do, find where — not API-style one-liners. */
/* eslint-disable no-useless-escape -- RouterOS uses $locals; JS templates must emit a literal dollar */
import { APP_NAME } from "../brand.ts";
import { pcqFromPayload } from "./pcq.ts";

export function rosQuote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function localBlock(vars: Record<string, string>) {
  return Object.entries(vars)
    .map(([k, v]) => `:local ${k} ${rosQuote(v)};`)
    .join("\n");
}

export function enrollRosScript(opts: {
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
}) {
  const identity = opts.identity || opts.name;
  const addr = opts.wgAddress.includes("/") ? opts.wgAddress : `${opts.wgAddress}/32`;
  const pull = opts.pullUrl || "";
  const peerKey = opts.serverPublic || opts.wgPublic;
  const endpointHost = (opts.endpointHost || "").trim();
  const endpointPort = opts.endpointPort || 51820;
  const hubIp = opts.serverAddress || "10.200.0.1";
  const allowed = "10.200.0.0/24";

  const endpointSet = endpointHost
    ? `  endpoint-address=${rosQuote(endpointHost)} endpoint-port=${endpointPort} \\`
    : "  \\";
  const missingEndpoint = endpointHost
    ? ""
    : `# No hub endpoint saved — the router cannot start the handshake.
# Settings → Network: set the VPS public hostname or IP, then copy this script again.
`;

  const scheduler = pull
    ? `
:do { /system script remove [find where name="gridline-pull"] } on-error={}
/system script add name=gridline-pull owner=admin policy=read,write,policy,test,password,sensitive source={
  :do {
    /tool fetch url=${rosQuote(pull)} mode=https check-certificate=no http-method=get dst-path=gridline-pull.rsc;
    :delay 2s;
    :if ([:len [/file find where name="gridline-pull.rsc"]] > 0) do={
      /import file-name=gridline-pull.rsc;
    }
  } on-error={
    :log warning "gridline-agent fetch failed";
  }
}

:do { /system scheduler remove [find where name="gridline-agent"] } on-error={}
/system scheduler add name=gridline-agent interval=1m start-time=startup \\
  policy=read,write,policy,test,password,sensitive \\
  on-event="/system script run gridline-pull";`
    : `
:do { /system scheduler remove [find where name="gridline-agent"] } on-error={}
/system scheduler add name=gridline-agent interval=1m start-time=startup \\
  on-event={ :log info ("gridline heartbeat " . ${rosQuote(opts.token)}) };`;

  return `# ${APP_NAME} agent enroll — RouterOS v7 script
# Paste in New Terminal, or: /import file-name=gridline-enroll.rsc
# Overlay ${addr} → hub ${hubIp} (UDP ${endpointPort})
# Syntax: :local / :if / :do on-error / find where
${missingEndpoint}
${localBlock({
    identity,
    token: opts.token,
    wgPriv: opts.wgPrivate || "",
    srvKey: peerKey,
    wgAddr: addr,
    allowed,
  })}

/system identity set name=\$identity;

:if ([:len [/interface wireguard find where name="wg-gridline"]] = 0) do={
  /interface wireguard add name=wg-gridline listen-port=13231 private-key=\$wgPriv comment="gridline-agent";
} else={
  /interface wireguard set [find where name="wg-gridline"] private-key=\$wgPriv listen-port=13231;
}

:if ([:len [/interface wireguard peers find where interface="wg-gridline" and comment="gridline-controller"]] = 0) do={
  /interface wireguard peers add interface=wg-gridline public-key=\$srvKey allowed-address=\$allowed \\
${endpointSet}
    persistent-keepalive=00:00:25 comment="gridline-controller";
} else={
  /interface wireguard peers set [find where interface="wg-gridline" and comment="gridline-controller"] \\
    public-key=\$srvKey allowed-address=\$allowed \\
${endpointSet}
    persistent-keepalive=00:00:25;
}

:if ([:len [/ip address find where interface="wg-gridline"]] = 0) do={
  /ip address add address=\$wgAddr interface=wg-gridline;
} else={
  /ip address set [find where interface="wg-gridline"] address=\$wgAddr;
}

:if ([:len [/ip firewall filter find where comment="gridline-agent"]] = 0) do={
  /ip firewall filter add chain=input in-interface=wg-gridline action=accept comment="gridline-agent" place-before=0;
}

/ip service set www-ssl disabled=no address=10.200.0.0/24;
/ip service set api disabled=no address=10.200.0.0/24;
/ip service set winbox address=10.200.0.0/24;

:log info ("gridline enrolled token=" . \$token);
${scheduler}
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

export function commandRosScript(kind: string, payload: Record<string, unknown>) {
  const user = String(payload.username || payload.name || "").trim();
  const password = String(payload.password || "");
  const ip = String(payload.static_ip || payload.address || "");
  const list = pcqFromPayload(payload).list;
  const comment = String(payload.service_id || "gridline");
  const disabled = payload.status === "suspended" || payload.status === "terminated" || payload.enabled === false;
  const qname = `static-${user || ip || "host"}`;

  if (kind === "package.sync") {
    return pcqEnsureRos(payload);
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
:do { /ip firewall address-list remove [find where list="gridline-active" and address=\$ip] } on-error={};`;
    }
    return `${pcqEnsureRos(payload)}

${localBlock({ qname, ip, user })}
:do { /queue simple remove [find where name=\$qname] } on-error={};
:do { /ip firewall address-list remove [find where address=\$ip and list~"^isp-"] } on-error={};
:if ([:len [/ip firewall address-list find where list=\$list and address=\$ip]] = 0) do={
  /ip firewall address-list add list=\$list address=\$ip comment=\$user;
}
:if ([:len [/ip firewall address-list find where list="gridline-active" and address=\$ip]] = 0) do={
  /ip firewall address-list add list=gridline-active address=\$ip comment=\$user;
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
    const identity = String(payload.identity || payload.name || "gridline");
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
    .map(
      (c) => `# --- ${c.kind} ${c.id}
${c.script}`,
    )
    .join("\n\n");
  return `# ${APP_NAME} agent pull — RouterOS v7
# /import file-name=gridline-pull.rsc
# identity: ${opts.identity}

{
${body || `  :log info ${rosQuote("gridline-agent idle")};`}

  :log info ${rosQuote(`gridline-agent applied ${opts.commands.length} command(s)`)};
}
`;
}
