import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeEvent } from "../api";
import { wsReconnectDelayMs } from "../lib/wsReconnect";
import { invalidateForEvent, wsUrl } from "../realtime";

type Handlers = {
  onNotificationNew?: (ev: RealtimeEvent) => void;
  onNotificationSeen?: (id: string) => void;
};

type WsDiag = {
  opens: number;
  closes: number;
  invalidates: number;
};

declare global {
  interface Window {
    __wsReady?: boolean;
    __m23Ws?: WsDiag;
  }
}

function bumpDiag(key: keyof WsDiag): void {
  if (typeof window === "undefined") return;
  const d = (window.__m23Ws ??= { opens: 0, closes: 0, invalidates: 0 });
  d[key] += 1;
}

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
    let everOpened = false;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        bumpDiag("closes");
        scheduleRetry();
        return;
      }
      bumpDiag("opens");
      ws.onopen = () => {
        attempt = 0;
        window.__wsReady = true;
        // Catch up after a gap — once per successful reconnect, not on every fail (M23).
        if (everOpened) {
          bumpDiag("invalidates");
          qc.invalidateQueries();
        }
        everOpened = true;
      };
      ws.onmessage = (evt) => {
        let ev: RealtimeEvent;
        try {
          ev = JSON.parse(String(evt.data)) as RealtimeEvent;
        } catch {
          return;
        }
        // Handlers first — toast must not depend on invalidate/coalesce (M16).
        if (ev.type === "notification.new") {
          handlersRef.current.onNotificationNew?.(ev);
        }
        if (ev.type === "notification.seen" && ev.ids?.[0]) {
          handlersRef.current.onNotificationSeen?.(ev.ids[0]);
        }
        try {
          invalidateForEvent(qc, ev);
        } catch {
          /* ignore — list will catch up on focus/reconnect */
        }
      };
      ws.onclose = () => {
        bumpDiag("closes");
        if (closed) return;
        window.__wsReady = false;
        // Do not invalidate on close — offline reconnect storm would refetch forever (M23).
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (closed) return;
      if (retry !== undefined) window.clearTimeout(retry);
      const delay = wsReconnectDelayMs(attempt);
      attempt += 1;
      retry = window.setTimeout(connect, delay);
    };

    connect();

    const onOnline = () => {
      if (closed) return;
      // Probe sooner after network returns (reset backoff).
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      attempt = 0;
      if (retry !== undefined) window.clearTimeout(retry);
      retry = window.setTimeout(connect, 0);
    };
    window.addEventListener("online", onOnline);

    return () => {
      closed = true;
      window.removeEventListener("online", onOnline);
      if (retry !== undefined) window.clearTimeout(retry);
      ws?.close();
    };
  }, [enabled, qc]);
}
