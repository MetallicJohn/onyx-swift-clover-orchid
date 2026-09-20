import { AsyncLocalStorage } from "node:async_hooks";

export type DbSessionHandle = import("pg").PoolClient | "pglite";

export const dbSession = new AsyncLocalStorage<DbSessionHandle>();

export function dbSessionActive() {
  return dbSession.getStore() != null;
}

type Pinner = <T>(fn: () => Promise<T>) => Promise<T>;

const fallbackPinner: Pinner = async (fn) => {
  if (dbSession.getStore()) return fn();
  return dbSession.run("pglite", fn);
};

let pinner: Pinner = fallbackPinner;

export function registerDbSessionPinner(next: Pinner) {
  pinner = next;
}

/** Pin RLS GUCs to one client for the current request or job. */
export function withDbSession<T>(fn: () => Promise<T>): Promise<T> {
  return pinner(fn);
}
