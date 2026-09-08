const DESTRUCTIVE = /^(raw\.script|system\.reboot|reboot|factory)/i;

export function initialCommandStatus(kind: string): "proposed" | "queued" {
  return DESTRUCTIVE.test(kind) ? "proposed" : "queued";
}

export function isDestructiveKind(kind: string) {
  return DESTRUCTIVE.test(kind);
}
