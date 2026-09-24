import { useEffect, useState } from "react";
import { currentPlatformIdentity } from "./server";

export type PlatformIdentity = {
  id: string;
  name: string;
  email: string;
  status: string;
  role: string;
  tenant_name: string;
  tenant_id: string;
  platform_admin: boolean;
};

/** Resolve the signed-in platform account. External sessions resolve as signed out. */
export function usePlatformIdentity(active: boolean) {
  const [state, setState] = useState<"pending" | "ok" | "no">(active ? "pending" : "no");
  const [identity, setIdentity] = useState<PlatformIdentity | null>(null);

  useEffect(() => {
    if (!active) {
      setState("no");
      setIdentity(null);
      return;
    }
    let cancelled = false;
    setState("pending");
    currentPlatformIdentity()
      .then((row) => {
        if (cancelled) return;
        setIdentity(row);
        setState("ok");
      })
      .catch(() => {
        if (cancelled) return;
        setIdentity(null);
        setState("no");
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { state, identity };
}
