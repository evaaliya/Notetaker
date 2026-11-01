import { QueryClient } from "@tanstack/react-query";
import { RealtimeEvent } from "./api";
import {
  InvalidateCoalescer,
  InvalidateKey,
  queryKeysForRealtimeEvent,
  WS_INVALIDATE_COALESCE_MS,
} from "./lib/wsInvalidateCoalesce";

export {
  InvalidateCoalescer,
  queryKeysForRealtimeEvent,
  WS_INVALIDATE_COALESCE_MS,
} from "./lib/wsInvalidateCoalesce";
export type { InvalidateKey, InvalidateFlush } from "./lib/wsInvalidateCoalesce";

/**
 * Per-QueryClient coalescer (M16). Module singleton keyed by client identity
 * so Strict Mode remounts reuse the same QC and flush still hits the live client.
 */
const coalescers = new WeakMap<QueryClient, InvalidateCoalescer>();

function coalescerFor(qc: QueryClient): InvalidateCoalescer {
  let c = coalescers.get(qc);
  if (!c) {
    c = new InvalidateCoalescer((keys: InvalidateKey[]) => {
      for (const key of keys) {
        // TanStack expects a mutable QueryKey array.
        void qc.invalidateQueries({ queryKey: key as unknown[] });
      }
    });
    coalescers.set(qc, c);
  }
  return c;
}

export function invalidateForEvent(qc: QueryClient, ev: RealtimeEvent): void {
  const keys = queryKeysForRealtimeEvent(ev);
  if (!keys.length) return;
  try {
    coalescerFor(qc).enqueue(keys);
  } catch {
    // Never block toast / seen handlers if coalesce misbehaves.
    for (const key of keys) {
      void qc.invalidateQueries({ queryKey: key as unknown[] });
    }
  }
}

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}
