export type RosScriptPack = {
  title?: string;
  bootstrap?: string;
  enroll?: string;
  extraLabel?: string;
  extra?: string;
};

export type RosScriptSection = {
  key: "bootstrap" | "enroll" | "extra";
  label: string;
  body: string;
};

export function scriptSections(pack: RosScriptPack | null | undefined): RosScriptSection[] {
  if (!pack) return [];
  const out: RosScriptSection[] = [];
  const bootstrap = pack.bootstrap?.trim() || "";
  const enroll = pack.enroll?.trim() || "";
  const extra = pack.extra?.trim() || "";
  if (bootstrap) out.push({ key: "bootstrap", label: "Bootstrap", body: bootstrap });
  if (enroll) out.push({ key: "enroll", label: "Enroll", body: enroll });
  if (extra) out.push({ key: "extra", label: pack.extraLabel?.trim() || "Script", body: extra });
  return out;
}

export function primaryScript(pack: RosScriptPack | null | undefined) {
  return scriptSections(pack)[0] ?? null;
}
