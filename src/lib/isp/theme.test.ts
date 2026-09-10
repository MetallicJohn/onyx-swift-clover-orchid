import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDataImage } from "../theme/assets.ts";
import { contrastFg, contrastRatio, normalizeHex } from "../theme/contrast.ts";
import { DEFAULT_PRESET, PRESET_BY_ID } from "../theme/presets.ts";
import { cssVars, resolvePalette, resolveTheme } from "../theme/resolve.ts";
import { hasPermission } from "./rbac.ts";
import { openTestDb } from "./test-db.ts";
import { loadPublicBranding, loadTenantTheme, publicBrandingPayload, saveTenantTheme } from "./theme.ts";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

test("new tenants receive the default teal / dark theme", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_theme_d', 'Default Co', 'default-co')`;
    const theme = await loadTenantTheme(sql, "ten_theme_d");
    assert.equal(theme.preset, DEFAULT_PRESET);
    assert.equal(theme.appearance, "dark");
    assert.equal(theme.primary, "");
    assert.equal(theme.logo, "");
    const pal = resolvePalette(theme, true);
    assert.equal(pal.primary, PRESET_BY_ID.teal.dark.primary);
  } finally {
    await close();
  }
});

test("tenant A branding never leaks onto tenant B", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_a', 'Ocean ISP', 'ocean-isp')`;
    await sql`insert into tenants (id, name, slug) values ('ten_b', 'Green ISP', 'green-isp')`;
    await saveTenantTheme(sql, "ten_a", { preset: "ocean", primary: "#1d4ed8", displayName: "Ocean Fiber" });
    await saveTenantTheme(sql, "ten_b", { preset: "emerald", primary: "#047857", displayName: "GreenNet" });
    const a = await loadTenantTheme(sql, "ten_a");
    const b = await loadTenantTheme(sql, "ten_b");
    assert.equal(a.preset, "ocean");
    assert.equal(a.displayName, "Ocean Fiber");
    assert.equal(a.primary, "#1d4ed8");
    assert.equal(b.preset, "emerald");
    assert.equal(b.displayName, "GreenNet");
    assert.equal(b.primary, "#047857");
    const pubA = await loadPublicBranding(sql, "ocean-isp");
    const pubB = await loadPublicBranding(sql, "green-isp");
    assert.equal(pubA?.displayName, "Ocean Fiber");
    assert.equal(pubB?.displayName, "GreenNet");
    assert.notEqual(pubA?.primary, pubB?.primary);
    const hidden = publicBrandingPayload(pubA!, "login");
    assert.equal(hidden.apply, true);
    await saveTenantTheme(sql, "ten_a", { brandLogin: false });
    const after = await loadPublicBranding(sql, "ocean-isp");
    assert.equal(publicBrandingPayload(after!, "login").apply, false);
    assert.equal(publicBrandingPayload(after!, "portal").apply, true);
  } finally {
    await close();
  }
});

test("switching saved theme on one ISP leaves the other unchanged", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_sw_a', 'A', 'sw-a')`;
    await sql`insert into tenants (id, name, slug) values ('ten_sw_b', 'B', 'sw-b')`;
    await saveTenantTheme(sql, "ten_sw_a", { preset: "royal" });
    await saveTenantTheme(sql, "ten_sw_b", { preset: "orange" });
    await saveTenantTheme(sql, "ten_sw_a", { preset: "slate", appearance: "light" });
    const a = await loadTenantTheme(sql, "ten_sw_a");
    const b = await loadTenantTheme(sql, "ten_sw_b");
    assert.equal(a.preset, "slate");
    assert.equal(a.appearance, "light");
    assert.equal(b.preset, "orange");
    assert.equal(b.appearance, "dark");
  } finally {
    await close();
  }
});

test("custom colours get an accessible button foreground", () => {
  const pal = resolvePalette({ preset: "teal", appearance: "dark", primary: "#f5f5f5", secondary: "", accent: "" }, true);
  assert.equal(normalizeHex(pal.primary), "#f5f5f5");
  assert.ok(contrastRatio(pal.primary, pal.primaryFg) >= 4.5);
  assert.equal(contrastFg("#0a0e13"), "#f7fafc");
  const resolved = resolveTheme(
    {
      tenantId: "t",
      preset: "teal",
      appearance: "dark",
      primary: "#0a0e13",
      secondary: "",
      accent: "",
      logo: "",
      favicon: "",
      displayName: "",
      brandLogin: true,
      brandPortal: true,
    },
    "X",
    true,
  );
  assert.ok(resolved.issues.some((i) => /too close to the background/i.test(i.message)));
  assert.equal(cssVars(pal)["--color-accent"], pal.primary);
  assert.equal(cssVars(pal)["--primary"], pal.primary);
});

test("image uploads reject SVG, wrong types, and oversized files", () => {
  assert.equal(parseDataImage(PNG, 400 * 1024).startsWith("data:image/png;base64,"), true);
  assert.throws(() => parseDataImage("data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==", 400 * 1024), /SVG/);
  assert.throws(() => parseDataImage("https://evil.example/x.png", 400 * 1024), /PNG/);
  assert.throws(() => parseDataImage(`data:image/png;base64,${"A".repeat(800_000)}`, 80 * 1024), /under/);
});

test("only owners and admins may manage appearance", () => {
  assert.equal(hasPermission("isp_owner", "settings.manage"), true);
  assert.equal(hasPermission("isp_admin", "settings.manage"), true);
  assert.equal(hasPermission("finance", "settings.manage"), false);
  assert.equal(hasPermission("technician", "settings.manage"), false);
  assert.equal(hasPermission("network_engineer", "settings.manage"), false);
});

test("theme server functions resolve the active tenant on the server", () => {
  const src = readFileSync(new URL("./server-theme.ts", import.meta.url), "utf8");
  assert.match(src, /requireWs/);
  assert.match(src, /assertPermission\(role, "settings.manage"\)/);
  assert.doesNotMatch(src, /data\.tenant_id|data\.tenantId/);
});

test("invalid hex is rejected", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_hex', 'Hex', 'hex-co')`;
    await assert.rejects(() => saveTenantTheme(sql, "ten_hex", { primary: "blue" }), /hex colour/);
    await assert.rejects(() => saveTenantTheme(sql, "ten_hex", { preset: "neon" }), /Unknown theme preset/);
  } finally {
    await close();
  }
});

test("saving a preset without custom primary writes that palette to invoice brand_color", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug, brand_color) values ('ten_pdf_theme', 'Emerald Co', 'emerald-co', '#4aa8a0')`;
    await saveTenantTheme(sql, "ten_pdf_theme", { preset: "emerald", appearance: "light" });
    const theme = await loadTenantTheme(sql, "ten_pdf_theme");
    assert.equal(theme.preset, "emerald");
    assert.equal(theme.primary, "");
    const pal = resolvePalette(theme, true);
    assert.equal(pal.primary, PRESET_BY_ID.emerald.light.primary);
    const [row] = await sql<{ brand_color: string }>`select brand_color from tenants where id = 'ten_pdf_theme'`;
    assert.equal(row?.brand_color, pal.primary);
  } finally {
    await close();
  }
});

test("public branding lookup restores RLS bypass off", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_pub', 'Pub ISP', 'pub-isp')`;
    await loadPublicBranding(sql, "pub-isp");
    const [row] = await sql.query<{ v: string }>("select current_setting('app.bypass_rls', true) as v");
    assert.equal(row?.v, "off");
  } finally {
    await close();
  }
});

test("css tokens include sidebar, header, and chart aliases", () => {
  const pal = resolvePalette({ preset: "ocean", appearance: "dark", primary: "", secondary: "", accent: "" }, true);
  const vars = cssVars(pal);
  assert.equal(vars["--sidebar"], pal.surface);
  assert.equal(vars["--header"], pal.bg);
  assert.equal(vars["--color-chart"], pal.primary);
  assert.equal(vars["--color-accent"], pal.primary);
});
