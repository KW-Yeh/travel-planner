import { db } from "../db/db";
import { SyncEngine, httpTransport } from "./engine";

const unauthorizedListeners = new Set<() => void>();

export function onSyncUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export const syncEngine = new SyncEngine(db, httpTransport, () => {
  for (const listener of unauthorizedListeners) listener();
});
