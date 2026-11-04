/**
 * UUID for client ids. `crypto.randomUUID` is secure-context-only
 * (HTTPS / localhost); on http://LAN-IP it is missing → TypeError.
 * Fallback is not RFC-4122, but unique enough for client/outbox keys.
 */
export function safeRandomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
