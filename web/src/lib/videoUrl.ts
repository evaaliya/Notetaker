/** Detect YouTube id or treat as direct video / other embeddable URL. */

export type VideoSource =
  | { kind: "youtube"; id: string; url: string }
  | { kind: "direct"; url: string };

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

export function parseVideoUrl(raw: string): VideoSource | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (YT_HOSTS.has(host)) {
    let id = "";
    if (host.includes("youtu.be")) {
      id = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
    } else if (url.pathname.startsWith("/shorts/")) {
      id = url.pathname.split("/")[2] ?? "";
    } else if (url.pathname.startsWith("/embed/")) {
      id = url.pathname.split("/")[2] ?? "";
    } else {
      id = url.searchParams.get("v") ?? "";
    }
    if (id) return { kind: "youtube", id, url: url.toString() };
  }
  return { kind: "direct", url: url.toString() };
}

export function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}
