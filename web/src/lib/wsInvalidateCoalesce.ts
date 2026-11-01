import type { RealtimeEvent } from "../api";

/** Query key as plain array (no type-only RQ imports — Playwright e2e friendly). */
export type InvalidateKey = readonly unknown[];

/** Default coalesce window for WS → Query invalidation (ms). */
export const WS_INVALIDATE_COALESCE_MS = 75;

export type InvalidateFlush = (keys: InvalidateKey[]) => void;

/**
 * Merges invalidation keys across rapid WS events into one flush.
 * Prevents refetch avalanches when many note.changed arrive in a burst (M16).
 */
export class InvalidateCoalescer {
  private pending = new Map<string, InvalidateKey>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushCount = 0;
  private onFlush: InvalidateFlush;
  private delayMs: number;
  private schedule: typeof setTimeout;
  private cancel: typeof clearTimeout;

  constructor(
    onFlush: InvalidateFlush,
    delayMs: number = WS_INVALIDATE_COALESCE_MS,
    schedule: typeof setTimeout = setTimeout,
    cancel: typeof clearTimeout = clearTimeout,
  ) {
    this.onFlush = onFlush;
    this.delayMs = delayMs;
    this.schedule = schedule;
    this.cancel = cancel;
  }

  enqueue(keys: InvalidateKey[]): void {
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

  getFlushCount(): number {
    return this.flushCount;
  }

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
export function queryKeysForRealtimeEvent(ev: RealtimeEvent): InvalidateKey[] {
  switch (ev.type) {
    case "note.changed":
    case "note.deleted":
    case "note.restored": {
      const keys: InvalidateKey[] = [
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
      const keys: InvalidateKey[] = [
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
