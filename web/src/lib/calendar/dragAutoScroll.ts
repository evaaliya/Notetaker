/** Edge band (px) that triggers auto-scroll during calendar DnD (M28). */
export const DRAG_AUTO_SCROLL_EDGE_PX = 48;
/** Max scroll speed px/frame near the absolute edge. */
const MAX_SPEED = 28;

type Ptr = { x: number; y: number };

let active = false;
let ptr: Ptr = { x: 0, y: 0 };
let raf = 0;

function scrollSpeed(distFromEdge: number, edge: number): number {
  if (distFromEdge >= edge) return 0;
  const t = 1 - distFromEdge / edge;
  return Math.ceil(MAX_SPEED * t * t);
}

function isScrollable(el: HTMLElement, axis: "y" | "x"): boolean {
  const style = window.getComputedStyle(el);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  if (!/(auto|scroll|overlay)/.test(overflow)) return false;
  if (axis === "y") return el.scrollHeight > el.clientHeight + 1;
  return el.scrollWidth > el.clientWidth + 1;
}

/** Collect scrollable ancestors + document scrolling element. */
function scrollTargets(fromX: number, fromY: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const add = (el: HTMLElement | null) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    out.push(el);
  };

  // Prefer calendar scroll hosts (month parent, week/day timelines, FC).
  document
    .querySelectorAll<HTMLElement>(".calendar-main, .tl-day-view, .tl-week, .fc-scroller")
    .forEach(add);

  let node: Element | null = document.elementFromPoint(fromX, fromY);
  while (node && node instanceof HTMLElement) {
    if (isScrollable(node, "y") || isScrollable(node, "x")) add(node);
    node = node.parentElement;
  }

  const root = (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  add(root);
  return out;
}

/** While aiming at the trash drop zone, freeze scroll so the zone stays under the pointer. */
function pointerOverTrashAim(x: number, y: number): boolean {
  const zone = document.querySelector<HTMLElement>(
    '[data-testid="cal-trash-zone"].visible, [data-testid="cal-trash-zone"].active, [data-cal-drop="trash"].visible',
  );
  if (!zone) return false;
  const r = zone.getBoundingClientRect();
  const pad = 24;
  return (
    x >= r.left - pad &&
    x <= r.right + pad &&
    y >= r.top - pad &&
    y <= r.bottom + pad
  );
}

function tick() {
  if (!active) return;
  const edge = DRAG_AUTO_SCROLL_EDGE_PX;
  const { x, y } = ptr;
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  if (pointerOverTrashAim(x, y)) {
    raf = window.requestAnimationFrame(tick);
    return;
  }

  for (const el of scrollTargets(x, y)) {
    const r = el.getBoundingClientRect();
    // Viewport-edge scroll for the document element; element-edge for others.
    const isDoc = el === document.documentElement || el === document.body || el === document.scrollingElement;

    if (isScrollable(el, "y") || isDoc) {
      let dy = 0;
      if (isDoc) {
        if (y < edge) dy = -scrollSpeed(y, edge);
        else if (y > vh - edge) dy = scrollSpeed(vh - y, edge);
      } else {
        if (y < r.top + edge) dy = -scrollSpeed(y - r.top, edge);
        else if (y > r.bottom - edge) dy = scrollSpeed(r.bottom - y, edge);
      }
      if (dy) el.scrollTop += dy;
    }

    if (isScrollable(el, "x") || isDoc) {
      let dx = 0;
      if (isDoc) {
        if (x < edge) dx = -scrollSpeed(x, edge);
        else if (x > vw - edge) dx = scrollSpeed(vw - x, edge);
      } else {
        if (x < r.left + edge) dx = -scrollSpeed(x - r.left, edge);
        else if (x > r.right - edge) dx = scrollSpeed(r.right - x, edge);
      }
      if (dx) el.scrollLeft += dx;
    }
  }

  raf = window.requestAnimationFrame(tick);
}

export function startDragAutoScroll(clientX: number, clientY: number): void {
  ptr = { x: clientX, y: clientY };
  if (active) return;
  active = true;
  raf = window.requestAnimationFrame(tick);
}

export function updateDragAutoScroll(clientX: number, clientY: number): void {
  ptr = { x: clientX, y: clientY };
  if (!active) startDragAutoScroll(clientX, clientY);
}

export function stopDragAutoScroll(): void {
  active = false;
  if (raf) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
}
