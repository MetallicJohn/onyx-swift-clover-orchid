/** RouterOS v7 script generation. Uses :local, :if, :do, find where — not API-style one-liners. */
/* eslint-disable no-useless-escape -- RouterOS uses $locals; JS templates must emit a literal dollar */

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
}) {
  const identity = opts.identity || opts.name;
  const addr = opts.wgAddress.includes("/") ? opts.wgAddress : `${opts.wgAddress}/32`;
  const pull = opts.pullUrl || "";

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

  return `# Gridline agent enroll — RouterOS v7 script
# Paste in New Terminal, or: /import file-name=gridline-enroll.rsc
# Syntax: :local / :if / :do on-error / find where

${localBlock({
    identity,
    token: opts.token,
    wgKey: opts.wgPublic,
    wgAddr: addr,
  })}

/system identity set name=\$identity;

:if ([:len [/interface wireguard find where name="wg-gridline"]] = 0) do={
  /interface wireguard add name=wg-gridline listen-port=13231 comment="gridline-agent";
}

:if ([:len [/interface wireguard peers find where interface="wg-gridline" and public-key=\$wgKey]] = 0) do={
  /interface wireguard peers add interface=wg-gridline public-key=\$wgKey allowed-address=10.200.0.1/32 persistent-keepalive=00:00:25 comment="gridline-controller";
}

:if ([:len [/ip address find where interface="wg-gridline"]] = 0) do={
  /ip address add address=\$wgAddr interface=wg-gridline;
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

export function commandRosScript(kind: string, payload: Record<string, unknown>) {
  const user = String(payload.username || payload.name || "").trim();
  const password = String(payload.password || "");
  const ip = String(payload.static_ip || payload.address || "");
  const profile = String(payload.package || payload.profile || "default");
  const comment = String(payload.service_id || "gridline");
  const up = Number(payload.upload_mbps || payload.up || 10);
  const down = Number(payload.download_mbps || payload.down || 10);
  const limit = `${up}M/${down}M`;
  const disabled = payload.status === "suspended" || payload.status === "terminated" || payload.enabled === false;
  const qname = `static-${user || ip || "host"}`;

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
    return `${localBlock({ user, pass: password, profile, comment })}
:if ([:len [/ppp secret find where name=\$user]] = 0) do={
  /ppp secret add name=\$user password=\$pass service=pppoe profile=\$profile comment=\$comment disabled=no;
} else={
  /ppp secret set [find where name=\$user] password=\$pass profile=\$profile disabled=no;
}`;
  }

  if (kind.startsWith("static.")) {
    if (kind.endsWith("disable") || disabled) {
      return `${localBlock({ qname, ip })}
:if ([:len [/queue simple find where name=\$qname]] > 0) do={
  /queue simple set [find where name=\$qname] disabled=yes;
}
:do { /ip firewall address-list remove [find where list="gridline-active" and address=\$ip] } on-error={};`;
    }
    return `${localBlock({ qname, ip, limit, user })}
:if ([:len [/queue simple find where name=\$qname]] = 0) do={
  /queue simple add name=\$qname target=(\$ip . "/32") max-limit=\$limit;
} else={
  /queue simple set [find where name=\$qname] max-limit=\$limit disabled=no;
}
:if ([:len [/ip firewall address-list find where list="gridline-active" and address=\$ip]] = 0) do={
  /ip firewall address-list add list=gridline-active address=\$ip comment=\$user;
}`;
  }

  if (kind.startsWith("hotspot.")) {
    if (!user) return "# missing hotspot username";
    if (kind.endsWith("disable") || disabled) {
      return `${localBlock({ user })}
:if ([:len [/ip hotspot user find where name=\$user]] > 0) do={
  /ip hotspot user set [find where name=\$user] disabled=yes;
}
:do { /ip hotspot active remove [find where user=\$user] } on-error={};`;
    }
    return `${localBlock({ user, pass: password, profile })}
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
  return `# Gridline agent pull — RouterOS v7
# /import file-name=gridline-pull.rsc
# identity: ${opts.identity}

{
${body || `  :log info ${rosQuote("gridline-agent idle")};`}

  :log info ${rosQuote(`gridline-agent applied ${opts.commands.length} command(s)`)};
}
`;
}
