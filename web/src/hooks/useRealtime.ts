import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeEvent } from "../api";
import { invalidateForEvent, wsUrl } from "../realtime";

type Handlers = {
  onNotificationNew?: (ev: RealtimeEvent) => void;
  onNotificationSeen?: (id: string) => void;
};

/** WS session: invalidate Query keys only; no local data copies (spec §5 / §7). */
export function useRealtime(enabled: boolean, handlers: Handlers = {}): void {
  const qc = useQueryClient();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retry: number | undefined;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (evt) => {
        let ev: RealtimeEvent;
        try {
          ev = JSON.parse(String(evt.data)) as RealtimeEvent;
        } catch {
          return;
        }
        invalidateForEvent(qc, ev);
        if (ev.type === "notification.new") {
          handlersRef.current.onNotificationNew?.(ev);
        }
        if (ev.type === "notification.seen" && ev.ids?.[0]) {
          handlersRef.current.onNotificationSeen?.(ev.ids[0]);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        // Events during the gap may be lost — full invalidate (spec §5).
        qc.invalidateQueries();
        const delay = Math.min(10_000, 500 * 2 ** attempt);
        attempt += 1;
        retry = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      ws?.close();
    };
  }, [enabled, qc]);
}
