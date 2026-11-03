import { expect, test, type Page } from "@playwright/test";
import { wsReconnectDelayMs } from "../src/lib/wsReconnect";
import { apiCreateNote, registerUi, uniqueLogin } from "./helpers";

const WIDTHS = [1210, 1190, 910, 890, 650, 630] as const;
const DWELL_MS = 10_000;

test("ws_reconnect_backoff_unit", () => {
  expect(wsReconnectDelayMs(0, () => 0)).toBe(1000);
  expect(wsReconnectDelayMs(0, () => 1)).toBe(1500);
  expect(wsReconnectDelayMs(1, () => 0)).toBe(1000);
  expect(wsReconnectDelayMs(1, () => 1)).toBe(3000);
  expect(wsReconnectDelayMs(5, () => 0)).toBe(15_000);
  expect(wsReconnectDelayMs(5, () => 1)).toBe(30_000);
  expect(wsReconnectDelayMs(10, () => 1)).toBe(30_000);
  for (let a = 0; a < 8; a++) {
    const d = wsReconnectDelayMs(a, () => 0.5);
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThanOrEqual(30_000);
  }
});

async function seedList(page: Page) {
  for (let i = 0; i < 6; i++) {
    await apiCreateNote(page.request, {
      title: `M23 ${i} ${"T".repeat(24)}`,
      body: `${"preview ".repeat(20)}\nline2`,
      starts_at: new Date(Date.now() + (i + 1) * 3600_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
      reminder_offsets: [10],
      tag_ids: [],
    });
  }
}

async function measureCls(page: Page, width: number): Promise<number> {
  await page.setViewportSize({ width, height: 720 });
  await page.goto("/list");
  await expect(page.getByTestId("list-note-row").first()).toBeVisible({
    timeout: 15_000,
  });

  await page.evaluate(() => {
    (window as unknown as { __m23Cls?: number }).__m23Cls = 0;
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const ls = e as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          };
          if (ls.hadRecentInput) continue;
          const w = window as unknown as { __m23Cls: number };
          w.__m23Cls += ls.value;
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
      (window as unknown as { __m23Po?: PerformanceObserver }).__m23Po = po;
    } catch {
      /* ignore */
    }
  });

  const t0 = Date.now();
  let flip = false;
  while (Date.now() - t0 < DWELL_MS) {
    flip = !flip;
    await page.setViewportSize({
      width: flip ? width : Math.max(320, width - 1),
      height: 720,
    });
    await page.waitForTimeout(200);
  }

  return page.evaluate(
    () => (window as unknown as { __m23Cls?: number }).__m23Cls ?? 0,
  );
}

test("e2e_no_layout_shift_at_breakpoints", async ({ page }) => {
  test.setTimeout(180_000);
  const login = uniqueLogin("m23cls");
  await registerUi(page, login);
  await seedList(page);

  const scores: { width: number; cls: number }[] = [];
  for (const w of WIDTHS) {
    const cls = await measureCls(page, w);
    scores.push({ width: w, cls });
    expect(cls, `CLS at ${w}`).toBeLessThan(0.01);
  }
  const sum = scores.reduce((a, s) => a + s.cls, 0);
  expect(sum, `Σ CLS ${JSON.stringify(scores)}`).toBeLessThan(0.01);
});

test("e2e_offline_no_rerender_storm", async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("m15.profile", "1");
    } catch {
      /* ignore */
    }
    const sockets: WebSocket[] = [];
    const Orig = window.WebSocket;
    const Wrapped = function (this: unknown, ...args: unknown[]) {
      const ws = new (Orig as unknown as {
        new (...a: unknown[]): WebSocket;
      })(...args);
      sockets.push(ws);
      (window as unknown as { __m23Sockets: WebSocket[] }).__m23Sockets = sockets;
      return ws;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = Orig.prototype;
    Object.assign(Wrapped, Orig);
    window.WebSocket = Wrapped;
  });

  const login = uniqueLogin("m23off");
  await registerUi(page, login);
  await seedList(page);
  await page.goto("/list");
  await expect(page.getByTestId("list-note-row").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => page.evaluate(() => !!(window as unknown as { __wsReady?: boolean }).__wsReady), {
      timeout: 10_000,
    })
    .toBe(true);

  let apiGets = 0;
  page.on("request", (req) => {
    if (req.method() === "GET" && req.url().includes("/api/")) apiGets += 1;
  });

  await page.evaluate(() => {
    (window as unknown as { __m15Renders: Record<string, { count: number }> }).__m15Renders =
      {};
    const diag = (window as unknown as {
      __m23Ws?: { opens: number; closes: number; invalidates: number };
    }).__m23Ws;
    if (diag) {
      diag.opens = 0;
      diag.closes = 0;
      diag.invalidates = 0;
    }
    for (const ws of (window as unknown as { __m23Sockets?: WebSocket[] }).__m23Sockets ?? []) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  });
  apiGets = 0;
  await context.setOffline(true);
  await page.waitForTimeout(DWELL_MS);

  const snap = await page.evaluate(() => {
    const renders = (window as unknown as {
      __m15Renders?: Record<string, { count: number }>;
    }).__m15Renders ?? {};
    let renderCount = 0;
    for (const k of Object.keys(renders)) renderCount += renders[k].count || 0;
    const diag = (window as unknown as {
      __m23Ws?: { opens: number; closes: number; invalidates: number };
    }).__m23Ws ?? { opens: 0, closes: 0, invalidates: 0 };
    return { renderCount, ...diag };
  });

  // No full-cache invalidate while reconnect is failing (M23).
  expect(snap.invalidates, JSON.stringify(snap)).toBe(0);
  // Backoff 1→30s: at most a handful of attempts in 10s.
  expect(snap.opens, JSON.stringify(snap)).toBeLessThanOrEqual(6);
  expect(snap.renderCount, JSON.stringify(snap)).toBeLessThanOrEqual(25);
  expect(apiGets).toBeLessThanOrEqual(8);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __m23Ws?: { invalidates: number } }).__m23Ws
              ?.invalidates ?? 0,
        ),
      { timeout: 15_000 },
    )
    .toBe(1);
});
