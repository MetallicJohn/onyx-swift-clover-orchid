import { createContext, useContext } from "react";
import type { PortalHome } from "./customer-portal-dto";

export type PortalState = {
  token: string;
  slug: string;
  home: PortalHome;
  refresh: () => Promise<void>;
  signOut: () => void;
};

export type PortalGate = {
  establish: (token: string, slug: string) => Promise<void>;
};

export const PortalCtx = createContext<PortalState | null>(null);
export const GateCtx = createContext<PortalGate | null>(null);

export function usePortal() {
  const v = useContext(PortalCtx);
  if (!v) throw new Error("Not signed in");
  return v;
}

export function usePortalSession() {
  return useContext(PortalCtx);
}

export function usePortalGate() {
  const g = useContext(GateCtx);
  if (!g) throw new Error("Portal unavailable");
  return g;
}
