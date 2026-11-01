import { QueryClient, QueryKey } from "@tanstack/react-query";
import { RealtimeEvent } from "./api";

/** Default coalesce window for WS → Query invalidation (ms). */
export const WS_INVALIDATE_COALESCE_MS = 75;

export type InvalidateFlush = (keys: QueryKey[]) => void;

/**
 * Merges invalidation keys across rapid WS events into one flush.
 * Prevents refetch avalanches when many note.changed arrive in a burst (M16).
 */
export class InvalidateCoalescer {
  private pending = new Map<string, QueryKey>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushCount = 0;

  constructor(
    private readonly onFlush: InvalidateFlush,
    private readonly delayMs: number = WS_INVALIDATE_COALESCE_MS,
    private readonly schedule: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout,
  ) {}

  enqueue(keys: QueryKey[]): void {
    for (const key of keys) {
      this.pending.set(JSON.stringify(key), key);
    }
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = this.schedule(() => {
      this.timer = null;
      const batch = [...this.pending.values()];
      this.pending.clear();
      this.flushCount += 1;
      this.onFlush(batch);
    }, this.delayMs);
  }

  /** Test helper: how many flush callbacks ran. */
  getFlushCount(): number {
    return this.flushCount;
  }

  /** Test helper: pending unique keys before flush. */
  pendingSize(): number {
    return this.pending.size;
  }

  dispose(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}

/** Pure: which Query keys an event should invalidate (no side effects). */
export function queryKeysForRealtimeEvent(ev: RealtimeEvent): QueryKey[] {
  switch (ev.type) {
    case "note.changed":
    case "note.deleted":
    case "note.restored": {
      const keys: QueryKey[] = [
        ["notes"],
        ["calendar"],
        ["upcoming"],
        ["trash"],
      ];
      for (const id of ev.ids ?? []) {
        keys.push(["note", id]);
      }
      return keys;
    }
    case "attachment.added":
    case "attachment.deleted": {
      const keys: QueryKey[] = [
        ["notes"],
        ["calendar"],
        ["upcoming"],
        ["trash"],
      ];
      if (ev.note_id) {
        keys.push(["attachments", ev.note_id]);
        keys.push(["note", ev.note_id]);
      }
      return keys;
    }
    case "tag.changed":
      return [["tags"], ["notes"], ["calendar"], ["upcoming"]];
    case "settings.changed":
      return [["me"], ["upcoming"], ["calendar"]];
    case "notification.new":
    case "notification.seen":
      return [["notifications"]];
    default:
      return [];
  }
}

let sharedCoalescer: InvalidateCoalescer | null = null;
const qcHolder: { current: QueryClient | null } = { current: null };

function sharedCoalescerInstance(): InvalidateCoalescer {
  if (!sharedCoalescer) {
    sharedCoalescer = new InvalidateCoalescer((keys) => {
      const client = qcHolder.current;
      if (!client) return;
      for (const queryKey of keys) {
        client.invalidateQueries({ queryKey });
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
