import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DND_LONG_PRESS_MS, DND_MOVE_CANCEL_PX } from "../lib/calendar/dnd";

type Handlers = {
  enabled: boolean;
  onArmed: (clientX: number, clientY: number) => void;
  onMove: (clientX: number, clientY: number) => void;
  onEnd: (clientX: number, clientY: number) => void;
  onCancel: () => void;
};

/**
 * Touch/pen: long-press then drag (move before arm = scroll, cancel).
 * Mouse: arm after moving past threshold (no long-press) so click still selects.
 */
export function useLongPressDrag({
  enabled,
  onArmed,
  onMove,
  onEnd,
  onCancel,
}: Handlers) {
  const timerRef = useRef<number | undefined>(undefined);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const didDragRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const pointerTypeRef = useRef<string>("mouse");
  const targetRef = useRef<Element | null>(null);
  const handlersRef = useRef({ onArmed, onMove, onEnd, onCancel });
  handlersRef.current = { onArmed, onMove, onEnd, onCancel };

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const arm = useCallback((pointerId: number, x: number, y: number) => {
    if (armedRef.current) return;
    armedRef.current = true;
    didDragRef.current = true;
    try {
      (targetRef.current as HTMLElement | null)?.setPointerCapture?.(pointerId);
    } catch {
      /* ignore */
    }
    handlersRef.current.onArmed(x, y);
  }, []);

  const resetTracking = useCallback(() => {
    clearTimer();
    startRef.current = null;
    armedRef.current = false;
    pointerIdRef.current = null;
  }, [clearTimer]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      didDragRef.current = false;
      pointerIdRef.current = e.pointerId;
      pointerTypeRef.current = e.pointerType || "mouse";
      targetRef.current = e.currentTarget;
      startRef.current = { x: e.clientX, y: e.clientY };
      armedRef.current = false;
      clearTimer();
      // Long-press only for touch/pen — protects scroll; mouse arms on move.
      if (pointerTypeRef.current !== "mouse") {
        const pid = e.pointerId;
        const sx = e.clientX;
        const sy = e.clientY;
        timerRef.current = window.setTimeout(() => {
          arm(pid, sx, sy);
        }, DND_LONG_PRESS_MS);
      }
    },
    [enabled, clearTimer, arm],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      const start = startRef.current;
      if (!start) return;
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!armedRef.current) {
        if (pointerTypeRef.current !== "mouse") {
          // Touch: movement before long-press → treat as scroll.
          if (dist > DND_MOVE_CANCEL_PX) {
            clearTimer();
            startRef.current = null;
            pointerIdRef.current = null;
          }
          return;
        }
        // Mouse: arm once past threshold.
        if (dist > DND_MOVE_CANCEL_PX) {
          arm(e.pointerId, e.clientX, e.clientY);
        } else {
          return;
        }
      }
      e.preventDefault();
      handlersRef.current.onMove(e.clientX, e.clientY);
    },
    [clearTimer, arm],
  );

  const finish = useCallback(
    (e: ReactPointerEvent, kind: "up" | "cancel") => {
      if (pointerIdRef.current !== e.pointerId) return;
      const wasArmed = armedRef.current;
      const x = e.clientX;
      const y = e.clientY;
      resetTracking();
      if (wasArmed) {
        if (kind === "up") handlersRef.current.onEnd(x, y);
        else handlersRef.current.onCancel();
      }
    },
    [resetTracking],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => finish(e, "up"),
    [finish],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => finish(e, "cancel"),
    [finish],
  );

  const suppressClickIfDragged = useCallback(() => {
    if (!didDragRef.current) return false;
    didDragRef.current = false;
    return true;
  }, []);

  // If the card unmounts mid-drag (query invalidate), clear chrome via onCancel.
  useEffect(() => {
    return () => {
      clearTimer();
      if (armedRef.current) {
        armedRef.current = false;
        handlersRef.current.onCancel();
      }
      pointerIdRef.current = null;
      startRef.current = null;
    };
  }, [clearTimer]);

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    suppressClickIfDragged,
  };
}
