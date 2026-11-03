/** Guarded ResizeObserver: rAF + ≥1px threshold + ignore self-driven layout. */

export type SizeBox = { width: number; height: number };

export type ObserveSizeOptions = {
  /** Min delta on either axis to fire (default 1). */
  thresholdPx?: number;
};

/**
 * Observe element size changes without feedback loops from the callback itself
 * (e.g. FullCalendar `updateSize` / virtualizer `measure`).
 */
export function observeElementSize(
  el: Element,
  onChange: (size: SizeBox) => void,
  opts: ObserveSizeOptions = {},
): () => void {
  const threshold = opts.thresholdPx ?? 1;
  let lastW = Number.NaN;
  let lastH = Number.NaN;
  let raf = 0;
  let ignoring = false;

  const ro = new ResizeObserver(() => {
    if (ignoring) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (ignoring) return;
      const r = el.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      if (
        Number.isFinite(lastW) &&
        Math.abs(w - lastW) < threshold &&
        Math.abs(h - lastH) < threshold
      ) {
        return;
      }
      lastW = w;
      lastH = h;
      ignoring = true;
      try {
        onChange({ width: w, height: h });
      } finally {
        requestAnimationFrame(() => {
          ignoring = false;
        });
      }
    });
  });
  ro.observe(el);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
  };
}
