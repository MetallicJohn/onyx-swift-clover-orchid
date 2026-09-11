/** PCQ-per-package names. One upload + one download type per speed, one PPP/hotspot profile per package. */

export function sanitizeRosName(raw: string, fallback = "pkg") {
  const slug = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug || fallback;
}

export function mbps(value: unknown, fallback = 10) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function mikrotikProfileName(packageName: string) {
  return `isp-${sanitizeRosName(packageName)}`;
}

export function pcqTypes(uploadMbps: unknown, downloadMbps: unknown) {
  const up = mbps(uploadMbps, 5);
  const down = mbps(downloadMbps, 10);
  return {
    up,
    down,
    upType: `isp-pcq-up-${up}M`,
    downType: `isp-pcq-down-${down}M`,
    upRate: `${up}M`,
    downRate: `${down}M`,
  };
}

export function packageAddressList(packageName: string) {
  return mikrotikProfileName(packageName);
}

export function pcqFromPayload(payload: Record<string, unknown>) {
  const packageName = String(payload.package || payload.profile || payload.package_name || "pkg");
  const profile = mikrotikProfileName(packageName);
  const types = pcqTypes(payload.upload_mbps ?? payload.up, payload.download_mbps ?? payload.down);
  return {
    packageName,
    profile,
    list: packageAddressList(packageName),
    markUp: `${profile}-up`,
    markDown: `${profile}-down`,
    treeUp: `${profile}-up`,
    treeDown: `${profile}-down`,
    commentUp: `isp-pcq ${profile} up`,
    commentDown: `isp-pcq ${profile} down`,
    ...types,
  };
}
