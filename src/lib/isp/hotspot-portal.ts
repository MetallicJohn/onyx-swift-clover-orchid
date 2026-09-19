import { nid } from "../utils.ts";
import { parseDataImage, MAX_LOGO_BYTES } from "../theme/assets.ts";
import { normalizeHex } from "../theme/contrast.ts";
import { THEME_FONTS, isFontId, type ThemeFontId } from "../theme/fonts.ts";
import {
  HOTSPOT_HTML_FILES,
  isHotspotHtmlFile,
  type HotspotHtmlFile,
  hotspotRouterStatus,
} from "./hotspot-dashboard-format.ts";
import { formatHotspotDuration, hotspotPackageDuration } from "./hotspot-duration.ts";
import { applyRls } from "./rls.ts";
import { loadTenantThemeNamed } from "./theme.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type HotspotPortalSettings = {
  title: string;
  welcome: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  logo_data: string;
  background_image: string;
  font_family: string;
  show_voucher: boolean;
  show_customer: boolean;
  show_packages: boolean;
  terms: string;
  support_phone: string;
  support_email: string;
  payment_instructions: string;
  custom_css: string;
  updated_at: string | null;
};

export type HotspotPortalPackage = {
  id: string;
  name: string;
  price_kes: number;
  validity_hours: number;
  download_mbps: number;
  upload_mbps: number;
  bundle_mb: number;
  description: string;
  duration_value: number;
  duration_unit: string;
  duration_label: string;
};

export type HotspotPortalBuyContext = {
  slug: string;
  origin: string;
};

export type HotspotPortalPatch = Partial<HotspotPortalSettings>;

export type HotspotDeployStatus = "queued" | "sent" | "waiting_for_router" | "verified" | "failed";

export type HotspotDeployVerdict = {
  status: HotspotDeployStatus;
  verified: boolean;
  message: string;
};

const DEFAULT_PRIMARY = "#4aa8a0";
const DEFAULT_BG = "#0a0e13";
const DEFAULT_FG = "#e8eef4";
const FONT_STACK: Record<string, string> = Object.fromEntries(THEME_FONTS.map((f) => [f.id, f.family]));

export const DEFAULT_PORTAL_SETTINGS: HotspotPortalSettings = {
  title: "",
  welcome: "Connect to Wi-Fi",
  primary_color: DEFAULT_PRIMARY,
  background_color: DEFAULT_BG,
  text_color: DEFAULT_FG,
  logo_data: "",
  background_image: "",
  font_family: "outfit",
  show_voucher: true,
  show_customer: true,
  show_packages: true,
  terms: "",
  support_phone: "",
  support_email: "",
  payment_instructions: "",
  custom_css: "",
  updated_at: null,
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026#39;");
}

function escapeCss(value: string) {
  return value.replace(/[^\s\w#%,.\-()/]/g, "");
}

export function sanitizePortalCss(raw: string) {
  let css = String(raw || "").slice(0, 8000);
  css = css.replace(/<\/style/gi, "");
  css = css.replace(/<script/gi, "");
  css = css.replace(/expression\s*\(/gi, "");
  css = css.replace(/@import/gi, "");
  css = css.replace(/javascript\s*:/gi, "");
  css = css.replace(/url\s*\(\s*['"]?\s*javascript/gi, "");
  return css;
}

export function sanitizePortalColor(raw: string, fallback: string) {
  return normalizeHex(raw) || fallback;
}

export function sanitizePortalFont(raw: string) {
  const id = String(raw || "").trim();
  if (isFontId(id)) return id;
  if (id === "system-ui") return "system-ui";
  return "outfit";
}

function fontCss(id: string) {
  if (id === "system-ui") return "system-ui, sans-serif";
  return FONT_STACK[id] || FONT_STACK.outfit || "system-ui, sans-serif";
}

function fontLink(id: string) {
  const row = THEME_FONTS.find((f) => f.id === id);
  if (!row?.google) return "";
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${row.google}&display=swap" />`;
}

export function normalizePortalSettings(raw: Partial<HotspotPortalSettings> | null | undefined): HotspotPortalSettings {
  const src = raw || {};
  const logo = (() => {
    const v = String(src.logo_data || "");
    if (!v) return "";
    try {
      return parseDataImage(v, MAX_LOGO_BYTES);
    } catch {
      return "";
    }
  })();
  const bgImage = (() => {
    const v = String(src.background_image || "");
    if (!v) return "";
    try {
      return parseDataImage(v, MAX_LOGO_BYTES);
    } catch {
      return "";
    }
  })();
  return {
    title: String(src.title || "").slice(0, 80),
    welcome: String(src.welcome || DEFAULT_PORTAL_SETTINGS.welcome).slice(0, 160),
    primary_color: sanitizePortalColor(String(src.primary_color || ""), DEFAULT_PRIMARY),
    background_color: sanitizePortalColor(String(src.background_color || ""), DEFAULT_BG),
    text_color: sanitizePortalColor(String(src.text_color || ""), DEFAULT_FG),
    logo_data: logo,
    background_image: bgImage,
    font_family: sanitizePortalFont(String(src.font_family || "outfit")),
    show_voucher: src.show_voucher !== false,
    show_customer: src.show_customer !== false,
    show_packages: src.show_packages !== false,
    terms: String(src.terms || "").slice(0, 2000),
    support_phone: String(src.support_phone || "").slice(0, 40),
    support_email: String(src.support_email || "").slice(0, 120),
    payment_instructions: String(src.payment_instructions || "").slice(0, 800),
    custom_css: sanitizePortalCss(String(src.custom_css || "")),
    updated_at: src.updated_at || null,
  };
}

export function interpretHotspotDeploy(opts: {
  commandStatus: string | null | undefined;
  commandResult?: string | null;
  verified?: boolean;
  simulated?: boolean;
}): HotspotDeployVerdict {
  if (opts.verified) {
    return { status: "verified", verified: true, message: "Hotspot files transferred and confirmed on the router." };
  }
  const status = String(opts.commandStatus || "").toLowerCase();
  const result = String(opts.commandResult || "");
  if (opts.simulated || /simulated REST/i.test(result)) {
    return {
      status: "waiting_for_router",
      verified: false,
      message: "Command compiled. Waiting for the router agent to confirm the files were written.",
    };
  }
  if (!status || status === "queued" || status === "proposed") {
    return { status: "queued", verified: false, message: "Waiting for the router to pull the command." };
  }
  if (status === "sent" || status === "running") {
    return { status: "sent", verified: false, message: "Router pulled the job. Waiting for file confirmation." };
  }
  if (status === "failed" || status === "error") {
    return { status: "failed", verified: false, message: result.slice(0, 240) || "Deploy failed." };
  }
  if (status === "acked" || status === "done") {
    if (/portal ok|files ok|verified/i.test(result)) {
      return { status: "verified", verified: true, message: "Hotspot files transferred and confirmed on the router." };
    }
    if (/missing|error|fail/i.test(result) && !/^ok$/i.test(result.trim())) {
      return { status: "failed", verified: false, message: result.slice(0, 240) };
    }
    return {
      status: "waiting_for_router",
      verified: false,
      message: "Router acknowledged the job. File presence is not confirmed yet.",
    };
  }
  return { status: "waiting_for_router", verified: false, message: "Deploy in progress." };
}

const PREVIEW_VARS: Record<string, string> = {
  username: "guest",
  password: "",
  error: "",
  "link-login-only": "#",
  "link-orig": "/",
  "link-logout": "#",
  "link-status": "#",
  "link-login": "#",
  "chap-id": "",
  "chap-challenge": "",
  mac: "AA:BB:CC:DD:EE:FF",
  ip: "10.10.10.20",
  identity: "hotspot-preview",
  hostname: "hotspot",
  "logged-in": "guest",
  uptime: "12m",
  "session-time-left": "1h 48m",
  "bytes-in-nice": "12.4 MB",
  "bytes-out-nice": "3.1 MB",
  "refresh-timeout": "60",
  trial: "no",
};

export function substituteHotspotVars(html: string, vars: Record<string, string> = PREVIEW_VARS) {
  let out = html.replace(/\$\(if\s+([a-z0-9-]+)\)([\s\S]*?)\$\(endif\)/gi, (_m, key: string, inner: string) => {
    const v = vars[key];
    return v ? inner : "";
  });
  out = out.replace(/\$\(([a-z0-9-]+)\)/gi, (_m, key: string) => vars[key] ?? "");
  return out;
}

function sharedCss(s: HotspotPortalSettings) {
  const bg = escapeCss(s.background_color);
  const fg = escapeCss(s.text_color);
  const accent = escapeCss(s.primary_color);
  const font = fontCss(s.font_family);
  const bgImg = s.background_image
    ? `body{background-image:url("${s.background_image}");background-size:cover;background-position:center;}`
    : "";
  return `*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:${font};background:${bg};color:${fg}}
body{display:flex;align-items:center;justify-content:center;padding:24px}
.shell{width:100%;max-width:420px;background:rgba(10,14,19,.92);border:1px solid rgba(232,238,244,.12);border-radius:20px;padding:28px 24px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
.brand{display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:20px;text-align:center}
.brand img{max-height:48px;max-width:180px}
.mark{width:44px;height:44px;border-radius:12px;background:${accent};color:#061014;display:grid;place-items:center;font-weight:700;font-size:18px}
h1{font-size:1.25rem;font-weight:600;margin:0;letter-spacing:-.02em}
.lead{margin:6px 0 0;color:rgba(232,238,244,.72);font-size:.9rem}
label{display:block;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:rgba(232,238,244,.55);margin:12px 0 6px}
input,button,select{width:100%;height:44px;border-radius:10px;border:1px solid rgba(232,238,244,.14);background:rgba(255,255,255,.04);color:${fg};padding:0 12px;font:inherit}
button{background:${accent};color:#061014;border:0;font-weight:600;cursor:pointer}
button.secondary{background:transparent;color:${fg};border:1px solid rgba(232,238,244,.18)}
.tabs{display:flex;gap:6px;margin:8px 0 4px}
.tabs button{height:36px;font-size:.8rem}
.err{background:rgba(212,106,106,.15);color:#f0b4b4;padding:10px 12px;border-radius:10px;font-size:.85rem;margin-bottom:12px}
.meta,.support{margin-top:16px;font-size:.8rem;color:rgba(232,238,244,.6);line-height:1.45}
.pkgs{display:grid;gap:10px;margin-top:16px;grid-template-columns:1fr}
.pkg{border:1px solid rgba(232,238,244,.12);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:.9rem;text-align:left}
.pkg .top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.pkg .meta{font-size:.78rem;color:rgba(232,238,244,.6)}
.pkg button.buy{height:40px;margin-top:4px}
.hs-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);align-items:flex-end;justify-content:center;padding:16px;z-index:20}
.hs-modal.open{display:flex}
.hs-card{width:100%;max-width:420px;background:#121820;border:1px solid rgba(232,238,244,.14);border-radius:18px;padding:20px 16px 16px}
.hs-card h2{margin:0 0 8px;font-size:1.05rem}
.hs-wait{font-size:.9rem;color:rgba(232,238,244,.75);line-height:1.45}
.hs-creds{font-family:ui-monospace,monospace;background:rgba(255,255,255,.05);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:.85rem}
.hs-actions{display:flex;gap:8px;margin-top:12px}
.hs-actions button{flex:1}
@media (min-width:520px){.pkgs{grid-template-columns:1fr 1fr}.hs-modal{align-items:center}}
.row{display:flex;justify-content:space-between;gap:12px;font-size:.9rem;margin:8px 0}
a{color:${accent}}
${bgImg}
${sanitizePortalCss(s.custom_css)}`;
}

function layout(s: HotspotPortalSettings, body: string) {
  const title = escapeHtml(s.title || "Wi-Fi");
  const logo = s.logo_data
    ? `<img src="${s.logo_data}" alt="${title}" />`
    : `<div class="mark">${escapeHtml((s.title || "H").slice(0, 1).toUpperCase())}</div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${fontLink(s.font_family)}
<style>${sharedCss(s)}</style>
</head>
<body>
<main class="shell">
  <div class="brand">${logo}<h1>${title}</h1></div>
  ${body}
</main>
</body>
</html>`;
}

function packageBlock(s: HotspotPortalSettings, packages: HotspotPortalPackage[], buy?: HotspotPortalBuyContext) {
  if (!s.show_packages || !packages.length) return "";
  const rows = packages
    .slice(0, 16)
    .map((p) => {
      const dur = p.duration_label || formatHotspotDuration(hotspotPackageDuration(p).value, hotspotPackageDuration(p).unit);
      const speed = p.download_mbps > 0 ? `${p.download_mbps} Mbps` : "";
      const cap = p.bundle_mb > 0 ? (p.bundle_mb % 1024 === 0 ? `${p.bundle_mb / 1024} GB` : `${p.bundle_mb} MB`) : "";
      const desc = p.description ? `<span class="meta">${escapeHtml(p.description)}</span>` : "";
      const meta = [`Valid for ${dur}`, speed, cap].filter(Boolean).join(" · ");
      return `<div class="pkg" data-pkg="${escapeHtml(p.id)}"><div class="top"><span><strong>${escapeHtml(p.name)}</strong><br /><span class="meta">${escapeHtml(meta)}</span>${desc ? `<br />${desc}` : ""}</span><strong>KSh ${p.price_kes}</strong></div><button type="button" class="buy" data-pkg="${escapeHtml(p.id)}">BUY</button></div>`;
    })
    .join("");
  return `<div class="pkgs">${rows}</div>${buyModal()}${buyScript(packages, buy)}`;
}

function buyModal() {
  return `<div id="hs-modal" class="hs-modal">
<div class="hs-card" role="dialog" aria-labelledby="hs-title">
<h2 id="hs-title">Buy Wi-Fi</h2>
<div id="hs-body"></div>
<div class="hs-actions">
<button type="button" id="hs-cancel" class="secondary">Cancel</button>
<button type="button" id="hs-pay">Pay now</button>
</div>
</div>
</div>`;
}

function buyScript(packages: HotspotPortalPackage[], buy?: HotspotPortalBuyContext) {
  const payload = JSON.stringify(
    packages.map((p) => ({
      id: p.id,
      name: p.name,
      price_kes: p.price_kes,
      duration_label: p.duration_label,
      download_mbps: p.download_mbps,
    })),
  ).replace(/</g, "\\u003c");
  const slug = JSON.stringify(buy?.slug || "");
  const origin = JSON.stringify(buy?.origin || "");
  return `<script>
(function(){
var pkgs=${payload};
var slug=${slug};
var origin=${origin};
function el(id){return document.getElementById(id)}
function api(path){
  var root = origin || (location && location.origin) || "";
  return root + path;
}
function pkgBy(id){
  for (var i=0;i<pkgs.length;i++) if (pkgs[i].id===id) return pkgs[i];
  return null;
}
var modal = el("hs-modal");
var body = el("hs-body");
var payBtn = el("hs-pay");
var cancelBtn = el("hs-cancel");
var selected = null;
var pollTimer = null;
var pollLeft = 0;
function closeModal(){
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (modal) { modal.className = "hs-modal"; }
}
function openModal(){
  if (!modal) return;
  modal.className = "hs-modal open";
}
function setPay(label, disabled){
  if (!payBtn) return;
  payBtn.textContent = label;
  payBtn.disabled = !!disabled;
  payBtn.style.display = disabled && label === "Hide" ? "none" : "";
}
function showPick(p){
  selected = p;
  body.innerHTML = "<p><strong>"+p.name+"</strong></p><p class=\\"hs-wait\\">KSh "+p.price_kes+" · "+p.duration_label+(p.download_mbps? " · "+p.download_mbps+" Mbps":"")+"</p><label>M-Pesa phone</label><input id=\\"hs-phone\\" type=\\"tel\\" inputmode=\\"tel\\" autocomplete=\\"tel\\" placeholder=\\"07XXXXXXXX\\" />";
  setPay("Pay now", false);
  if (cancelBtn) cancelBtn.textContent = "Cancel";
  var phone = el("hs-phone");
  if (phone) setTimeout(function(){ phone.focus(); }, 50);
}
function showWait(){
  body.innerHTML = "<p class=\\"hs-wait\\"><strong>M-Pesa payment request sent</strong><br/>Check your phone and enter your M-Pesa PIN to complete the payment.</p>";
  setPay("Waiting…", true);
}
function showFail(msg){
  body.innerHTML = "<p class=\\"hs-wait\\">"+(msg || "Payment failed. You can try again.")+"</p>";
  setPay("Retry", false);
}
function showOk(d){
  var html = "<p><strong>Payment Successful</strong></p><p class=\\"hs-wait\\">Package: "+(d.package_name||"")+"<br/>Amount: KSh "+d.amount_kes+"</p>";
  if (d.activated_at) html += "<p class=\\"hs-wait\\">Activated: "+fmt(d.activated_at)+"</p>";
  if (d.expires_at) html += "<p class=\\"hs-wait\\">Expires: "+fmt(d.expires_at)+"</p>";
  if (d.username) html += "<div class=\\"hs-creds\\">Username: "+d.username+"<br/>Password: "+d.password+"</div>";
  html += "<p class=\\"hs-wait\\">Sign in with these credentials to get online.</p>";
  body.innerHTML = html;
  setPay("Connect", false);
  payBtn.setAttribute("data-ok","1");
  if (d.username) { payBtn._u = d.username; payBtn._p = d.password; }
}
function fmt(iso){
  try {
    var dt = new Date(iso);
    return dt.toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).replace(",", "");
  } catch(e) { return iso; }
}
function fillLogin(u, p){
  var form = document.querySelector("form[name=login]") || document.querySelector("form");
  if (!form) return;
  var user = form.querySelector("input[name=username]");
  var pass = form.querySelector("input[name=password]");
  if (user) user.value = u || "";
  if (pass) pass.value = p || "";
  if (typeof doLogin === "function") { doLogin(); return; }
  if (form.requestSubmit) form.requestSubmit();
  else form.submit();
}
document.addEventListener("click", function(ev){
  var t = ev.target;
  if (!t || !t.getAttribute) return;
  if (t.className === "buy" || (t.getAttribute && t.getAttribute("data-pkg") && t.tagName === "BUTTON")) {
    var id = t.getAttribute("data-pkg");
    var p = pkgBy(id);
    if (!p) return;
    payBtn.removeAttribute("data-ok");
    showPick(p);
    openModal();
  }
});
if (cancelBtn) cancelBtn.onclick = function(){ closeModal(); };
if (payBtn) payBtn.onclick = function(){
  if (payBtn.getAttribute("data-ok") === "1") {
    fillLogin(payBtn._u, payBtn._p);
    closeModal();
    return;
  }
  if (!selected) return;
  var phoneEl = el("hs-phone");
  var phone = phoneEl ? phoneEl.value : "";
  if (!phone || phone.replace(/\\D/g,"").length < 9) {
    showFail("Enter a valid Kenyan M-Pesa number");
    return;
  }
  showWait();
  fetch(api("/api/v1/hotspot/purchase"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: slug, package_id: selected.id, phone: phone })
  }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
  .then(function(res){
    if (!res.ok) { showFail(res.j && res.j.error ? res.j.error : "Could not start payment"); return; }
    startPoll(res.j.id);
  }).catch(function(){ showFail("Could not reach the payment service"); });
};
function startPoll(id){
  pollLeft = 48;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function(){
    pollLeft -= 1;
    if (pollLeft <= 0) { clearInterval(pollTimer); pollTimer = null; showFail("The M-Pesa prompt timed out. You can try again."); return; }
    fetch(api("/api/v1/hotspot/purchase-status?slug="+encodeURIComponent(slug)+"&id="+encodeURIComponent(id)))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.payment_status === "confirmed") { clearInterval(pollTimer); pollTimer = null; showOk(d); }
        else if (d.payment_status === "failed" || d.payment_status === "cancelled" || d.payment_status === "reversed") {
          clearInterval(pollTimer); pollTimer = null; showFail(d.note);
        }
      }).catch(function(){});
  }, 2500);
}
})();
</script>`;
}

function supportBlock(s: HotspotPortalSettings) {
  const bits = [s.support_phone, s.support_email].filter(Boolean).map(escapeHtml);
  const pay = s.payment_instructions ? `<p>${escapeHtml(s.payment_instructions)}</p>` : "";
  const terms = s.terms ? `<p>${escapeHtml(s.terms)}</p>` : "";
  if (!bits.length && !pay && !terms) return "";
  return `<div class="support">${bits.length ? `<p>${bits.join(" · ")}</p>` : ""}${pay}${terms}</div>`;
}

function loginHtml(s: HotspotPortalSettings, packages: HotspotPortalPackage[], buy?: HotspotPortalBuyContext) {
  const voucherName = s.show_voucher ? "login" : "login-voucher";
  const customerName = s.show_voucher ? "login-account" : "login";
  const voucher = s.show_voucher
    ? `<form name="${voucherName}" action="$(link-login-only)" method="post" $(if chap-id) onSubmit="return doLogin()" $(endif)>
<input type="hidden" name="dst" value="$(link-orig)" />
<input type="hidden" name="popup" value="true" />
<label>Voucher code</label>
<input name="username" type="text" autocapitalize="off" autocorrect="off" value="$(username)" placeholder="HS-XXXXXXXX" />
<label>Password</label>
<input name="password" type="password" placeholder="Same as voucher, if required" />
<div style="height:12px"></div>
<button type="submit">Connect</button>
</form>`
    : "";
  const customer = s.show_customer
    ? `<form name="${customerName}" action="$(link-login-only)" method="post" $(if chap-id) onSubmit="return doLogin()" $(endif)>
<input type="hidden" name="dst" value="$(link-orig)" />
<input type="hidden" name="popup" value="true" />
<label>Username</label>
<input name="username" type="text" autocapitalize="off" value="$(username)" />
<label>Password</label>
<input name="password" type="password" />
<div style="height:12px"></div>
<button type="submit">Sign in</button>
</form>`
    : "";
  const both = s.show_voucher && s.show_customer;
  const tabScript = both
    ? `<script>
function hsTab(id) {
  var v = document.getElementById('voucher');
  var c = document.getElementById('customer');
  if (v) v.style.display = id === 'voucher' ? 'block' : 'none';
  if (c) c.style.display = id === 'customer' ? 'block' : 'none';
  var vf = v && v.querySelector('form');
  var cf = c && c.querySelector('form');
  if (vf) vf.name = id === 'voucher' ? 'login' : 'login-voucher';
  if (cf) cf.name = id === 'customer' ? 'login' : 'login-account';
}
</script>`
    : "";
  const body = `
<p class="lead">${escapeHtml(s.welcome)}</p>
$(if error)<div class="err">$(error)</div>$(endif)
${tabScript}
$(if chap-id)
<form name="sendin" action="$(link-login-only)" method="post" style="display:none">
<input type="hidden" name="username" />
<input type="hidden" name="password" />
<input type="hidden" name="dst" value="$(link-orig)" />
<input type="hidden" name="popup" value="true" />
</form>
<script src="/md5.js"></script>
<script>
function doLogin() {
  document.sendin.username.value = document.login.username.value;
  document.sendin.password.value = hexMD5('$(chap-id)' + document.login.password.value + '$(chap-challenge)');
  document.sendin.submit();
  return false;
}
</script>
$(endif)
${both ? `<div class="tabs"><button type="button" onclick="hsTab('voucher')">Voucher</button><button type="button" class="secondary" onclick="hsTab('customer')">Account</button></div>` : ""}
<div id="voucher" style="${s.show_voucher ? "" : "display:none"}">${voucher}</div>
<div id="customer" style="${s.show_customer && !s.show_voucher ? "" : s.show_customer ? "display:none" : "display:none"}">${customer}</div>
${packageBlock(s, packages, buy)}
${supportBlock(s)}
`;
  return layout(s, body);
}

function statusHtml(s: HotspotPortalSettings) {
  const body = `
<p class="lead">You are online.</p>
<div class="row"><span>User</span><strong>$(logged-in)</strong></div>
<div class="row"><span>IP</span><strong>$(ip)</strong></div>
<div class="row"><span>Uptime</span><strong>$(uptime)</strong></div>
<div class="row"><span>Time left</span><strong>$(session-time-left)</strong></div>
<div class="row"><span>Download</span><strong>$(bytes-in-nice)</strong></div>
<div class="row"><span>Upload</span><strong>$(bytes-out-nice)</strong></div>
<form action="$(link-logout)" method="post" style="margin-top:16px">
<button type="submit" class="secondary">Log out</button>
</form>
<meta http-equiv="refresh" content="$(refresh-timeout)" />
${supportBlock(s)}`;
  return layout(s, body);
}

function logoutHtml(s: HotspotPortalSettings) {
  return layout(
    s,
    `<p class="lead">You have been disconnected.</p>
<form action="$(link-login)" method="get"><button type="submit">Sign in again</button></form>
${supportBlock(s)}`,
  );
}

function aloginHtml(s: HotspotPortalSettings) {
  return layout(
    s,
    `<p class="lead">Connected. Redirecting…</p>
<meta http-equiv="refresh" content="1; url=$(link-redirect)">
<p class="meta"><a href="$(link-redirect)">Continue</a></p>`,
  );
}

function errorHtml(s: HotspotPortalSettings) {
  return layout(
    s,
    `<div class="err">$(error)</div>
<p class="lead">The hotspot could not complete that request.</p>
<p class="meta"><a href="$(link-login)">Back to login</a></p>
${supportBlock(s)}`,
  );
}

/** Compact hexMD5 matching the MikroTik hotspot login contract. */
export const HOTSPOT_MD5_JS = `function hexMD5(s){
function cmn(q,a,b,x,s,t){a=add32(add32(a,q),add32(x,t));return add32((a<<s)|(a>>>32-s),b)}
function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t)}
function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t)}
function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)}
function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t)}
function md51(k){var n=k.length,s=[1732584193,-271733879,-1732584194,271733878],m=[],i,l;
for(i=64;i<=k.length;i+=64){md5cycle(s,md5blk(k.substring(i-64,i)))}
k=k.substring(i-64);for(i=0;i<k.length;i++)m[i>>2]|=k.charCodeAt(i)<<((i%4)<<3);
m[i>>2]|=0x80<<((i%4)<<3);if(i>55){md5cycle(s,m);for(i=0;i<16;i++)m[i]=0}
m[14]=n*8;md5cycle(s,m);return s}
function md5cycle(x,k){var a=x[0],b=x[1],c=x[2],d=x[3];
a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3])}
function md5blk(s){var md5blks=[],i;for(i=0;i<64;i+=4)md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);return md5blks}
function rhex(n){var s='',j,h='0123456789abcdef';for(j=0;j<4;j++)s+=h.charAt((n>>(j*8+4))&0x0F)+h.charAt((n>>(j*8))&0x0F);return s}
function hex(x){for(var i=0;i<x.length;i++)x[i]=rhex(x[i]);return x.join('')}
function add32(a,b){return (a+b)&0xFFFFFFFF}
function md5blks(){}
return hex(md51(s))}
`;

export function generateHotspotFiles(
  settings: HotspotPortalSettings,
  packages: HotspotPortalPackage[] = [],
  buy?: HotspotPortalBuyContext,
) {
  const s = normalizePortalSettings(settings);
  return {
    "login.html": loginHtml(s, packages, buy),
    "alogin.html": aloginHtml(s),
    "status.html": statusHtml(s),
    "logout.html": logoutHtml(s),
    "error.html": errorHtml(s),
    "md5.js": HOTSPOT_MD5_JS,
  } satisfies Record<HotspotHtmlFile, string>;
}

export function requiredHotspotFilesPresent(files: Record<string, string>) {
  return HOTSPOT_HTML_FILES.every((name) => typeof files[name] === "string" && files[name].length > 0);
}

export async function loadHotspotPackages(sql: Sql, tenantId: string): Promise<HotspotPortalPackage[]> {
  const rows = await sql<{
    id: string;
    name: string;
    price_kes: number;
    validity_hours: number;
    download_mbps: number;
    upload_mbps: number;
    bundle_mb: number;
    description: string;
    duration_value: number;
    duration_unit: string;
  }>`
    select id, name, price_kes, coalesce(validity_hours, 0)::int as validity_hours, download_mbps, upload_mbps,
           coalesce(bundle_mb,0)::int as bundle_mb, coalesce(description,'') as description,
           coalesce(duration_value,0)::int as duration_value, coalesce(duration_unit,'hours') as duration_unit
    from packages
    where tenant_id = ${tenantId} and access_method = 'hotspot' and active = true
    order by price_kes, name`;
  return rows.map((p) => {
    const dur = hotspotPackageDuration(p);
    return { ...p, duration_value: dur.value, duration_unit: dur.unit, duration_label: formatHotspotDuration(dur.value, dur.unit) };
  });
}

export async function loadHotspotBuyContext(sql: Sql, tenantId: string): Promise<HotspotPortalBuyContext> {
  const [ten] = await sql<{ slug: string }>`select slug from tenants where id = ${tenantId}`;
  const { tenantPublicOriginOrEmpty } = await import("./domain-resolve.ts");
  const origin = (await tenantPublicOriginOrEmpty(sql, tenantId, "public_api")).replace(/\/$/, "");
  return { slug: ten?.slug || "", origin };
}

export async function defaultPortalFromTheme(sql: Sql, tenantId: string): Promise<HotspotPortalSettings> {
  const { config, name } = await loadTenantThemeNamed(sql, tenantId);
  const [ten] = await sql<{ support_phone: string; support_email: string }>`
    select coalesce(support_phone,'') as support_phone, coalesce(support_email,'') as support_email
    from tenants where id = ${tenantId}`;
  return normalizePortalSettings({
    ...DEFAULT_PORTAL_SETTINGS,
    title: config.displayName || name || "Wi-Fi",
    primary_color: config.primary || DEFAULT_PRIMARY,
    background_color: DEFAULT_BG,
    text_color: DEFAULT_FG,
    logo_data: config.logo || "",
    font_family: (config.font as ThemeFontId) || "outfit",
    support_phone: ten?.support_phone || "",
    support_email: ten?.support_email || "",
  });
}

export async function getHotspotPortalSettings(sql: Sql, tenantId: string): Promise<HotspotPortalSettings> {
  const [row] = await sql<HotspotPortalSettings>`
    select title, welcome, primary_color, background_color, text_color, logo_data, background_image,
           font_family, show_voucher, show_customer, show_packages, terms, support_phone, support_email,
           payment_instructions, custom_css, updated_at::text as updated_at
    from hotspot_portal_settings where tenant_id = ${tenantId}`;
  if (!row) return defaultPortalFromTheme(sql, tenantId);
  return normalizePortalSettings(row);
}

export async function saveHotspotPortalSettings(sql: Sql, tenantId: string, patch: HotspotPortalPatch) {
  const current = await getHotspotPortalSettings(sql, tenantId);
  const next = normalizePortalSettings({ ...current, ...patch, updated_at: new Date().toISOString() });
  await sql`
    insert into hotspot_portal_settings (
      tenant_id, title, welcome, primary_color, background_color, text_color, logo_data, background_image,
      font_family, show_voucher, show_customer, show_packages, terms, support_phone, support_email,
      payment_instructions, custom_css, updated_at
    ) values (
      ${tenantId}, ${next.title}, ${next.welcome}, ${next.primary_color}, ${next.background_color}, ${next.text_color},
      ${next.logo_data}, ${next.background_image}, ${next.font_family}, ${next.show_voucher}, ${next.show_customer},
      ${next.show_packages}, ${next.terms}, ${next.support_phone}, ${next.support_email}, ${next.payment_instructions},
      ${next.custom_css}, now()
    )
    on conflict (tenant_id) do update set
      title = excluded.title,
      welcome = excluded.welcome,
      primary_color = excluded.primary_color,
      background_color = excluded.background_color,
      text_color = excluded.text_color,
      logo_data = excluded.logo_data,
      background_image = excluded.background_image,
      font_family = excluded.font_family,
      show_voucher = excluded.show_voucher,
      show_customer = excluded.show_customer,
      show_packages = excluded.show_packages,
      terms = excluded.terms,
      support_phone = excluded.support_phone,
      support_email = excluded.support_email,
      payment_instructions = excluded.payment_instructions,
      custom_css = excluded.custom_css,
      updated_at = now()`;
  return next;
}

export async function getHotspotHtmlFile(sql: Sql, tenantId: string, file: string) {
  if (!isHotspotHtmlFile(file)) return null;
  const settings = await getHotspotPortalSettings(sql, tenantId);
  const packages = await loadHotspotPackages(sql, tenantId);
  const buy = await loadHotspotBuyContext(sql, tenantId);
  const files = generateHotspotFiles(settings, packages, buy);
  return { name: file, body: files[file], contentType: file.endsWith(".js") ? "application/javascript" : "text/html; charset=utf-8" };
}

export async function listHotspotPortalRouters(sql: Sql, tenantId: string, now = Date.now()) {
  const rows = await sql<{
    id: string;
    name: string;
    identity: string;
    management_ip: string;
    location: string;
    last_seen: string | null;
    wg_status: string;
    enabled: boolean;
    enroll_token: string;
  }>`select id, name, coalesce(identity,'') as identity, coalesce(management_ip,'') as management_ip,
           coalesce(location,'') as location, last_seen::text as last_seen, wg_status,
           coalesce(enabled, true) as enabled, coalesce(enroll_token,'') as enroll_token
    from routers
    where tenant_id = ${tenantId} and archived_at is null and role = 'hotspot'
    order by name`;
  return rows.map((r) => {
    const status = hotspotRouterStatus(r.last_seen, r.wg_status, r.enabled !== false, now);
    return {
      id: r.id,
      name: r.name,
      identity: r.identity,
      management_ip: r.management_ip,
      location: r.location,
      last_seen: r.last_seen,
      status,
      online: status === "online",
      has_token: Boolean(r.enroll_token),
    };
  });
}

export async function recordHotspotDeployment(
  sql: Sql,
  opts: { tenantId: string; routerId: string; commandId: string | null; status: string; result?: string; verified?: boolean },
) {
  const id = nid("hdep");
  await sql`
    insert into hotspot_deployments (id, tenant_id, router_id, command_id, status, result, verified)
    values (${id}, ${opts.tenantId}, ${opts.routerId}, ${opts.commandId}, ${opts.status}, ${opts.result || ""}, ${Boolean(opts.verified)})`;
  return id;
}

export async function markHotspotDeployment(
  sql: Sql,
  opts: { tenantId: string; id: string; status: string; result?: string; verified?: boolean },
) {
  await sql`
    update hotspot_deployments
    set status = ${opts.status},
        result = ${opts.result ?? ""},
        verified = ${Boolean(opts.verified)},
        updated_at = now()
    where id = ${opts.id} and tenant_id = ${opts.tenantId}`;
}

export async function latestHotspotDeployment(sql: Sql, tenantId: string, routerId?: string) {
  const rows = await sql.query<{
    id: string;
    router_id: string;
    command_id: string | null;
    status: string;
    result: string;
    verified: boolean;
    created_at: string;
    updated_at: string;
    router_name: string;
  }>(
    `select d.id, d.router_id, d.command_id, d.status, d.result, d.verified,
            d.created_at::text as created_at, d.updated_at::text as updated_at,
            coalesce(r.name, '') as router_name
     from hotspot_deployments d
     left join routers r on r.id = d.router_id
     where d.tenant_id = $1 ${routerId ? "and d.router_id = $2" : ""}
     order by d.created_at desc
     limit 1`,
    routerId ? [tenantId, routerId] : [tenantId],
  );
  return rows[0] ?? null;
}

export function hotspotHtmlUrl(origin: string, file: string, token: string) {
  const root = origin.replace(/\/$/, "");
  return `${root}/api/v1/hotspot/html/${encodeURIComponent(file)}?token=${encodeURIComponent(token)}`;
}

export function hotspotDeployVerifyUrl(origin: string, opts: { token: string; id: string; ok: boolean }) {
  const root = origin.replace(/\/$/, "");
  return `${root}/api/v1/hotspot/deploy-verify?token=${encodeURIComponent(opts.token)}&id=${encodeURIComponent(opts.id)}&ok=${opts.ok ? "1" : "0"}`;
}

export async function routerByEnrollToken(sql: Sql, token: string) {
  const t = token.trim();
  if (!t) return null;
  const [r] = await sql<{ id: string; tenant_id: string; name: string; enroll_token: string }>`
    select id, tenant_id, name, enroll_token from routers where enroll_token = ${t}`;
  return r ?? null;
}

export async function serveHotspotHtmlFile(sql: Sql, token: string, file: string) {
  if (!isHotspotHtmlFile(file)) return { status: 404 as const, body: "unknown file", contentType: "text/plain" };
  await applyRls(sql, { bypass: true });
  const router = await routerByEnrollToken(sql, token);
  if (!router) return { status: 404 as const, body: "unknown token", contentType: "text/plain" };
  await applyRls(sql, { tenantId: router.tenant_id, bypass: false });
  const served = await getHotspotHtmlFile(sql, router.tenant_id, file);
  if (!served) return { status: 404 as const, body: "unknown file", contentType: "text/plain" };
  return { status: 200 as const, body: served.body, contentType: served.contentType };
}

export async function confirmHotspotDeploy(sql: Sql, token: string, deploymentId: string, ok: boolean) {
  await applyRls(sql, { bypass: true });
  const router = await routerByEnrollToken(sql, token);
  if (!router) return { ok: false as const, status: 404 as const };
  await applyRls(sql, { tenantId: router.tenant_id, bypass: false });
  const [row] = await sql<{ id: string; router_id: string }>`
    select id, router_id from hotspot_deployments
    where id = ${deploymentId} and tenant_id = ${router.tenant_id}`;
  if (!row || row.router_id !== router.id) return { ok: false as const, status: 404 as const };
  await markHotspotDeployment(sql, {
    tenantId: router.tenant_id,
    id: row.id,
    status: ok ? "verified" : "failed",
    result: ok ? "portal ok" : "router reported missing hotspot files",
    verified: ok,
  });
  if (ok) {
    await sql`update agent_commands set result = 'portal ok'
      where id = (select command_id from hotspot_deployments where id = ${row.id}) and tenant_id = ${router.tenant_id}`;
  }
  return { ok: true as const, status: 200 as const, verified: ok };
}

