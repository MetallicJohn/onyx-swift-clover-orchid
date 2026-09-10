export const GRIDLINE_GIT_URL = "https://github.com/MetallicJohn/onyx-swift-clover-orchid.git";

export function vpsInstallCommand(opts: { domain: string; email: string }) {
  const domain = (opts.domain || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || "ops.yourisp.co.ke";
  const email = (opts.email || "").trim() || "you@yourisp.co.ke";
  return `git clone ${GRIDLINE_GIT_URL} /opt/gridline && sudo bash /opt/gridline/deploy/vps/install.sh --domain ${domain} --email ${email}`;
}

export function vpsUpdateCommand() {
  return "sudo bash /opt/gridline/deploy/vps/update.sh";
}

export function vpsPublishSteps(opts: { domain: string; email: string }) {
  const domain = (opts.domain || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || "ops.yourisp.co.ke";
  const cmd = vpsInstallCommand({ domain, email: opts.email });
  const update = vpsUpdateCommand();
  return {
    domain,
    command: cmd,
    updateCommand: update,
    notes: [
      "Ubuntu 24.04 VPS with 4 GB RAM or more. Point the domain A record at the VPS first.",
      `First time: ${cmd}`,
      `Already installed: ${update}  (pulls GitHub, rebuilds, turns on auto-publish)`,
      "After that, each push to main is pulled and rebuilt on the VPS within a few minutes. Secrets in gridline.env are never overwritten.",
      "Optional instant publish: GitHub repo secrets VPS_HOST, VPS_USER, VPS_SSH_KEY — then every green main build SSHs and runs the updater.",
      "Sign in at https://" + domain + "/login, then set Settings → Public URL.",
      "Settings → Network: hub endpoint = this VPS, then wg-quick up wg-gridline and copy each router script.",
    ],
  };
}
