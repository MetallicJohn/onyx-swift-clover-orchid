export const GRIDLINE_GIT_URL = "https://github.com/MetallicJohn/onyx-swift-clover-orchid.git";

export function vpsInstallCommand(opts: { domain: string; email: string }) {
  const domain = (opts.domain || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || "ops.yourisp.co.ke";
  const email = (opts.email || "").trim() || "you@yourisp.co.ke";
  return `git clone ${GRIDLINE_GIT_URL} /opt/gridline && sudo bash /opt/gridline/deploy/vps/install.sh --domain ${domain} --email ${email}`;
}

export function vpsPublishSteps(opts: { domain: string; email: string }) {
  const domain = (opts.domain || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || "ops.yourisp.co.ke";
  const cmd = vpsInstallCommand({ domain, email: opts.email });
  return {
    domain,
    command: cmd,
    notes: [
      "Ubuntu 24.04 VPS with 2 GB RAM or more. Point the domain A record at the VPS first.",
      `Clone and install: ${cmd}`,
      "Sign in at https://" + domain + "/login, then set Settings → Public URL.",
      "Settings → Network: hub endpoint = this VPS, then wg-quick up wg-gridline and copy each router script.",
    ],
  };
}
