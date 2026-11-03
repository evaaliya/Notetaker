/**
 * M23 pre-fix diagnostics: CLS / ResizeObserver / WS / API / renders
 * at breakpoint-adjacent widths, online + offline.
 *
 * Oscillates viewport ±1px during dwell to provoke scrollbar / media flips.
 *
 * Usage (stack up on :5173):
 *   cd web && PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
 *     node scripts/m23_jitter_diag.mjs
 */
import { chromium } from "playwright";

const WIDTHS = [1210, 1190, 910, 890, 650, 630];
const DWELL_MS = 10_000;
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";

async function injectCounters(page) {
  await page.addInitScript(() => {
    const g = (window.__m23 = {
      ro: 0,
      wsOpen: 0,
      wsClose: 0,
      wsError: 0,
      invalidate: 0,
      cls: 0,
    });
    try {
      localStorage.setItem("m15.profile", "1");
    } catch {
      /* ignore */
    }
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          g.cls += e.value;
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    } catch {
      /* ignore */
    }
    const OrigRO = window.ResizeObserver;
    window.ResizeObserver = class extends OrigRO {
      constructor(cb) {
        super((entries, obs) => {
          g.ro += 1;
          cb(entries, obs);
        });
      }
    };
    const OrigWS = window.WebSocket;
    window.WebSocket = function (...args) {
      g.wsOpen += 1;
      let ws;
      try {
        ws = new OrigWS(...args);
      } catch (e) {
        g.wsError += 1;
        throw e;
      }
      ws.addEventListener("close", () => {
        g.wsClose += 1;
      });
      ws.addEventListener("error", () => {
        g.wsError += 1;
      });
      return ws;
    };
    window.WebSocket.prototype = OrigWS.prototype;
    Object.assign(window.WebSocket, OrigWS);

    // Hook invalidateQueries once TanStack mounts (poll).
    const hook = () => {
      const qc = window.__queryClient;
      if (!qc || qc.__m23Hooked) return;
      const orig = qc.invalidateQueries.bind(qc);
      qc.invalidateQueries = (...a) => {
        g.invalidate += 1;
        return orig(...a);
      };
      qc.__m23Hooked = true;
    };
    setInterval(hook, 50);
  });
}

async function register(page, login) {
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.locator('input[autocomplete="username"]').fill(login);
  await page.locator('input[type="password"]').fill("secret");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await page.getByRole("navigation").waitFor({ timeout: 15_000 });
}

async function seedNotes(page) {
  for (let i = 0; i < 12; i++) {
    const res = await page.request.post(BASE + "/api/notes", {
      data: {
        title: `M23 diag ${i} ${"T".repeat(40)}`,
        body: `${"preview ".repeat(40)}\n${"line2 ".repeat(20)}`,
        starts_at: new Date(Date.now() + (i + 1) * 3600_000)
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
        reminder_offsets: [10],
        tag_ids: [],
      },
    });
    if (!res.ok()) throw new Error(`create note ${await res.text()}`);
  }
}

async function measure(page, width, mode) {
  let apiGets = 0;
  const onReq = (req) => {
    if (req.method() === "GET" && req.url().includes("/api/")) apiGets += 1;
  };
  page.on("request", onReq);

  await page.context().setOffline(false);
  await page.setViewportSize({ width, height: 720 });
  await page.goto(BASE + "/list");
  await page.getByTestId("list-note-row").first().waitFor({ timeout: 15_000 });
  // Expose QueryClient if app set it; else leave invalidate=0 and use wsClose proxy.
  await page.evaluate(() => {
    window.__m23.ro = 0;
    window.__m23.wsOpen = 0;
    window.__m23.wsClose = 0;
    window.__m23.wsError = 0;
    window.__m23.invalidate = 0;
    window.__m23.cls = 0;
    window.__m15Renders = {};
  });
  apiGets = 0;

  if (mode === "offline") {
    await page.context().setOffline(true);
  }

  const t0 = Date.now();
  let flip = false;
  while (Date.now() - t0 < DWELL_MS) {
    flip = !flip;
    await page.setViewportSize({ width: flip ? width : width - 1, height: 720 });
    await page.waitForTimeout(200);
  }

  const snap = await page.evaluate(() => {
    const g = window.__m23;
    const renders = window.__m15Renders || {};
    let renderCount = 0;
    for (const k of Object.keys(renders)) renderCount += renders[k].count || 0;
    return {
      cls: g.cls,
      ro: g.ro,
      wsOpen: g.wsOpen,
      wsClose: g.wsClose,
      wsError: g.wsError,
      invalidate: g.invalidate,
      renderCount,
      gutter: getComputedStyle(document.documentElement).scrollbarGutter,
      mq900: window.matchMedia("(max-width: 900px)").matches,
      mq640: window.matchMedia("(max-width: 640px)").matches,
    };
  });

  page.off("request", onReq);
  await page.context().setOffline(false);

  const sec = DWELL_MS / 1000;
  return {
    width,
    mode,
    cls: Number(snap.cls.toFixed(4)),
    ro: snap.ro,
    ro_per_s: Number((snap.ro / sec).toFixed(2)),
    ws_open: snap.wsOpen,
    ws_close: snap.wsClose,
    ws_error: snap.wsError,
    ws_per_s: Number(((snap.wsOpen + snap.wsClose) / sec).toFixed(2)),
    invalidate: snap.invalidate,
    invalidate_proxy_per_s: Number(
      ((snap.invalidate || snap.wsClose) / sec).toFixed(2),
    ),
    api_get_per_s: Number((apiGets / sec).toFixed(2)),
    renders: snap.renderCount,
    renders_per_s: Number((snap.renderCount / sec).toFixed(2)),
    gutter: snap.gutter,
    mq900: snap.mq900,
    mq640: snap.mq640,
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await injectCounters(page);

const login = `m23d_${Date.now().toString(36)}`;
await register(page, login);
await seedNotes(page);

const rows = [];
for (const w of WIDTHS) {
  for (const mode of ["online", "offline"]) {
    const r = await measure(page, w, mode);
    rows.push(r);
    console.log(JSON.stringify(r));
  }
}

console.log("\n=== TABLE ===");
console.log(
  "| width | mode | CLS | RO (n /s) | WS o/c/e | inv≈/s | API GET/s | renders |",
);
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.width} | ${r.mode} | ${r.cls} | ${r.ro} / ${r.ro_per_s} | ${r.ws_open}/${r.ws_close}/${r.ws_error} | ${r.invalidate_proxy_per_s} | ${r.api_get_per_s} | ${r.renders} |`,
  );
}

await browser.close();
