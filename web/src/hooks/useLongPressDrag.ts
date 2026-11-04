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

type DragRefs = {
  timer: number | undefined;
  start: { x: number; y: number } | null;
  armed: boolean;
  didDrag: boolean;
  pointerId: number | null;
  pointerType: string;
  target: Element | null;
  windowListening: boolean;
  handlers: Handlers;
};

/**
 * Touch/pen: long-press then drag (move before arm = scroll, cancel).
 * Mouse: arm after moving past threshold (no long-press) so click still selects.
 *
 * After pointerdown, move/up/cancel listen on `window` so a lost
 * setPointerCapture (or up over trash/panel) still finishes the drag (D-132).
 */
export function useLongPressDrag({
  enabled,
  onArmed,
  onMove,
  onEnd,
  onCancel,
}: Handlers) {
  const stateRef = useRef<DragRefs>({
    timer: undefined,
    start: null,
    armed: false,
    didDrag: false,
    pointerId: null,
    pointerType: "mouse",
    target: null,
    windowListening: false,
    handlers: { enabled, onArmed, onMove, onEnd, onCancel },
  });
  stateRef.current.handlers = { enabled, onArmed, onMove, onEnd, onCancel };

  // Stable window listeners (same function identity for add/remove).
  const windowListenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
    detach: () => void;
    arm: (pointerId: number, x: number, y: number) => void;
  } | null>(null);

  if (!windowListenersRef.current) {
    const clearTimer = () => {
      const s = stateRef.current;
      if (s.timer !== undefined) {
        window.clearTimeout(s.timer);
        s.timer = undefined;
      }
    };

    const detach = () => {
      const s = stateRef.current;
      if (!s.windowListening || !windowListenersRef.current) return;
      s.windowListening = false;
      const L = windowListenersRef.current;
      window.removeEventListener("pointermove", L.move);
      window.removeEventListener("pointerup", L.up);
      window.removeEventListener("pointercancel", L.cancel);
    };

    const resetTracking = () => {
      clearTimer();
      detach();
      const s = stateRef.current;
      s.start = null;
      s.armed = false;
      s.pointerId = null;
    };

    const arm = (pointerId: number, x: number, y: number) => {
      const s = stateRef.current;
      if (s.armed) return;
      s.armed = true;
      s.didDrag = true;
      try {
        (s.target as HTMLElement | null)?.setPointerCapture?.(pointerId);
      } catch {
        /* capture is best-effort; window listeners still finish the drag */
      }
      s.handlers.onArmed(x, y);
    };

    const move = (e: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== e.pointerId) return;
      const start = s.start;
      if (!start) return;
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (!s.armed) {
        if (s.pointerType !== "mouse") {
          if (dist > DND_MOVE_CANCEL_PX) {
            clearTimer();
            s.start = null;
            s.pointerId = null;
            detach();
          }
          return;
        }
        if (dist > DND_MOVE_CANCEL_PX) {
          arm(e.pointerId, e.clientX, e.clientY);
        } else {
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      s.handlers.onMove(e.clientX, e.clientY);
    };

    const up = (e: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== e.pointerId) return;
      const wasArmed = s.armed;
      const x = e.clientX;
      const y = e.clientY;
      resetTracking();
      if (wasArmed) s.handlers.onEnd(x, y);
    };

    const cancel = (e: PointerEvent) => {
      const s = stateRef.current;
      if (s.pointerId !== e.pointerId) return;
      const wasArmed = s.armed;
      resetTracking();
      if (wasArmed) s.handlers.onCancel();
    };

    windowListenersRef.current = { move, up, cancel, detach, arm };
  }

  const L = windowListenersRef.current;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const s = stateRef.current;
      s.didDrag = false;
      s.pointerId = e.pointerId;
      s.pointerType = e.pointerType || "mouse";
      s.target = e.currentTarget;
      s.start = { x: e.clientX, y: e.clientY };
      s.armed = false;
      if (s.timer !== undefined) {
        window.clearTimeout(s.timer);
        s.timer = undefined;
      }
      if (!s.windowListening) {
        s.windowListening = true;
        window.addEventListener("pointermove", L.move);
        window.addEventListener("pointerup", L.up);
        window.addEventListener("pointercancel", L.cancel);
      }
      if (s.pointerType !== "mouse") {
        const pid = e.pointerId;
        const sx = e.clientX;
        const sy = e.clientY;
        s.timer = window.setTimeout(() => {
          L.arm(pid, sx, sy);
        }, DND_LONG_PRESS_MS);
      }
    },
    [enabled, L],
  );

  const suppressClickIfDragged = useCallback(() => {
    const s = stateRef.current;
    if (!s.didDrag) return false;
    s.didDrag = false;
    return true;
  }, []);

  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (s.timer !== undefined) {
        window.clearTimeout(s.timer);
        s.timer = undefined;
      }
      if (s.armed) {
        s.armed = false;
        s.handlers.onCancel();
      }
      s.pointerId = null;
      s.start = null;
      L.detach();
    };
  }, [L]);

  return {
    bind: {
      onPointerDown,
    },
    suppressClickIfDragged,
  };
}
