import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../components/app-shell.tsx", import.meta.url), "utf8");
const platform = readFileSync(new URL("../../components/platform/shell.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../../components/sidebar-nav.tsx", import.meta.url), "utf8");

test("console navbar uses dedicated CSS, clips labels, and keeps Devices as the ACS label", () => {
  assert.match(css, /\.app-shell\s*\{/);
  assert.match(css, /--nav-w:/);
  assert.match(css, /--nav-expanded:\s*15rem/);
  assert.match(css, /--nav-collapsed:\s*4\.5rem/);
  assert.match(css, /\.app-nav\s*\{/);
  assert.match(css, /overflow:\s*visible/);
  assert.match(css, /\.app-nav-handle\s*\{/);
  assert.match(css, /translateX\(50%\)/);
  assert.match(css, /\[data-collapsed="true"\]/);
  assert.match(css, /\.app-nav-label/);
  assert.match(css, /\.app-shell-body/);
  assert.match(css, /\.app-topbar/);
  assert.match(nav, /className="app-nav-item"/);
  assert.match(nav, /className="app-nav-label"/);
  assert.match(nav, /className="app-nav-handle"/);
  assert.match(nav, /app-nav-handle-icon/);
  assert.doesNotMatch(nav, /sr-only/);
  assert.match(shell, /className="app-shell"/);
  assert.match(shell, /className="app-nav"/);
  assert.match(shell, /data-collapsed=\{collapsed \? "true" : "false"\}/);
  assert.match(shell, /className="app-nav-foot"/);
  assert.match(shell, /to: "\/app\/acs", label: "Devices"/);
  assert.doesNotMatch(shell, /to: "\/app\/acs", label: "GenieACS"/);
  assert.match(shell, /\/app\/recycle-bin/);
  assert.match(platform, /className="app-shell"/);
  assert.match(platform, /className="app-nav"/);
  assert.match(platform, /SidebarCollapseButton/);
});
