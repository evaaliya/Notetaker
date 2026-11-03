/**
 * Exponential backoff for WebSocket reconnect: 1s → 30s with jitter.
 * attempt 0 → ~0.5–1.0s, 1 → ~1–2s, … capped at 30s base before jitter.
 */
export function wsReconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exp = Math.max(0, Math.floor(attempt));
  const base = Math.min(30_000, 1000 * 2 ** exp);
  const jittered = base * (0.5 + random());
  return Math.min(30_000, Math.max(1000, Math.round(jittered)));
}
