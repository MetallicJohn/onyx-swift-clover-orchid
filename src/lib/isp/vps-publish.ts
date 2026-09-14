export const ISPSOLUTIONS_GIT_URL = "https://github.com/MetallicJohn/onyx-swift-clover-orchid.git";

export function vpsInstallCommand(opts: { domain: string; email: string }) {
  const domain = (opts.domain || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim() || "ops.yourisp.co.ke";
  const email = (opts.email || "").trim() || "you@yourisp.co.ke";
  return `git clone ${ISPSOLUTIONS_GIT_URL} /opt/ispsolutions && sudo bash /opt/ispsolutions/deploy/vps/install.sh --domain ${domain} --email ${email}`;
}

export function vpsUpdateCommand() {
  return "sudo bash /opt/ispsolutions/deploy/vps/update.sh";
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
      `Already installed: ${update} --apply  (backup, pull green main, rebuild, health, rollback)`,
      "Do not deploy from Grok or an untested branch. Push to GitHub, wait for CI on main, back up, then deploy on the VPS.",
      "Optional CI SSH: repo secrets VPS_HOST, VPS_SSH_KEY, optional VPS_USER (root), VPS_PATH (/opt/ispsolutions), VPS_HEALTH_URL. Then a green main build SSHs and runs the updater.",
      "Timer fetches origin/main every few minutes but does not rebuild unless ISPSOLUTIONS_AUTO_DEPLOY=1.",
      "Sign in at https://" + domain + "/login, then set Settings → Public URL.",
      "Settings → Network: hub endpoint = this VPS, then run the hub install script (brings up wg-ispsolutions) and copy each router script.",
      "ACS: set the public VPS host in System settings. Each ISP gets a unique TR-069 port (7551–7999) via cwmp-edge. Open TCP 7551-7999; keep GenieACS NBI (7557) and the ACS auth endpoint private. ONUs log in with that ISP's ACS username and password. HTTPS ACS URLs are optional.",
    ],
  };
}
