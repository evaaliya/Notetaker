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

let sharedCoalescer: InvalidateCoalescer | null = null;
const qcHolder: { current: QueryClient | null } = { current: null };

function sharedCoalescerInstance(): InvalidateCoalescer {
  if (!sharedCoalescer) {
    sharedCoalescer = new InvalidateCoalescer((keys: InvalidateKey[]) => {
      const client = qcHolder.current;
      if (!client) return;
      for (const queryKey of keys) {
        client.invalidateQueries({ queryKey: [...queryKey] });
      }
    });
  }
  return sharedCoalescer;
}

/** Reset shared coalescer (tests / HMR). */
export function resetInvalidateCoalescer(): void {
  sharedCoalescer?.dispose();
  sharedCoalescer = null;
  qcHolder.current = null;
}

export function invalidateForEvent(qc: QueryClient, ev: RealtimeEvent): void {
  const keys = queryKeysForRealtimeEvent(ev);
  if (!keys.length) return;
  qcHolder.current = qc;
  sharedCoalescerInstance().enqueue(keys);
}

export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}
