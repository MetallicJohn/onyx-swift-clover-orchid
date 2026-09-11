/** Only exact in-app destinations. Rejects open redirects. */
const ALLOWED = new Set(["/app", "/platform"]);

export function loginModeFromSearch(search: string): "in" | "up" {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return q.get("mode") === "up" ? "up" : "in";
}

export function loginDestination(search: string, mode: "in" | "up"): "/app" | "/platform" {
  if (mode === "up") return "/app";
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const next = q.get("next") || "";
  if (next === "/platform") return "/platform";
  return "/app";
}

export function isAllowedLoginNext(path: string) {
  return ALLOWED.has(path);
}
