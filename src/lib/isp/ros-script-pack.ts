export type RosScriptKind =
  | "enroll"
  | "repair"
  | "wireguard-rotate"
  | "api-rotate"
  | "agent"
  | "bootstrap"
  | "extra";

export type RosScriptPack = {
  title?: string;
  description?: string;
  identity?: string;
  routerId?: string;
  kind?: RosScriptKind;
  bootstrap?: string;
  enroll?: string;
  extraLabel?: string;
  extra?: string;
};

export type RosScriptSection = {
  key: "bootstrap" | "enroll" | "extra";
  label: string;
  body: string;
  kind: RosScriptKind;
};

export function rscFilename(opts: { routerId?: string; identity?: string; kind?: string }) {
  const id = String(opts.routerId || opts.identity || "router").replace(/[^A-Za-z0-9._-]/g, "") || "router";
  const kind = String(opts.kind || "enroll").replace(/[^A-Za-z0-9._-]/g, "") || "enroll";
  return `ispsolutions-${id}-${kind}.rsc`;
}

export function scriptSections(pack: RosScriptPack | null | undefined): RosScriptSection[] {
  if (!pack) return [];
  const out: RosScriptSection[] = [];
  const bootstrap = pack.bootstrap?.trim() || "";
  const enroll = pack.enroll?.trim() || "";
  const extra = pack.extra?.trim() || "";
  const enrollKind: RosScriptKind =
    pack.kind === "repair" ||
    pack.kind === "wireguard-rotate" ||
    pack.kind === "api-rotate" ||
    pack.kind === "agent" ||
    pack.kind === "enroll"
      ? pack.kind
      : "enroll";
  const enrollLabel =
    enrollKind === "repair"
      ? "Repair"
      : enrollKind === "wireguard-rotate"
        ? "WireGuard rotation"
        : enrollKind === "api-rotate"
          ? "API credentials"
          : enrollKind === "agent"
            ? "Agent"
            : "Enroll";
  const enrollSection: RosScriptSection | null = enroll
    ? { key: "enroll", label: enrollLabel, body: enroll, kind: enrollKind }
    : null;
  const bootstrapSection: RosScriptSection | null = bootstrap
    ? { key: "bootstrap", label: "Bootstrap", body: bootstrap, kind: "bootstrap" }
    : null;
  const extraSection: RosScriptSection | null = extra
    ? { key: "extra", label: pack.extraLabel?.trim() || "Script", body: extra, kind: pack.kind === "api-rotate" ? "api-rotate" : "extra" }
    : null;
  const enrollFirst =
    pack.kind === "enroll" ||
    pack.kind === "repair" ||
    pack.kind === "wireguard-rotate" ||
    pack.kind === "api-rotate" ||
    pack.kind === "agent";
  if (enrollFirst) {
    if (enrollSection) out.push(enrollSection);
    if (bootstrapSection) out.push(bootstrapSection);
    if (extraSection) out.push(extraSection);
  } else {
    if (bootstrapSection) out.push(bootstrapSection);
    if (enrollSection) out.push(enrollSection);
    if (extraSection) out.push(extraSection);
  }
  return out;
}

export function primaryScript(pack: RosScriptPack | null | undefined) {
  return scriptSections(pack)[0] ?? null;
}
