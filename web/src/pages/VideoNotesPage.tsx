import { FormEvent, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Note, User } from "../api";
import { formatTimecode, parseVideoUrl, VideoSource } from "../lib/videoUrl";

type YTPlayer = {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string;
          playerVars?: Record<string, number | string>;
          events?: { onReady?: () => void };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (document.querySelector('script[data-yt-api="1"]')) return;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.dataset.ytApi = "1";
    s.onerror = () => reject(new Error("Не удалось загрузить YouTube IFrame API (нужна сеть)"));
    document.head.appendChild(s);
  });
}

export function VideoNotesPage({ user: _user }: { user: User }) {
  const qc = useQueryClient();
  const [urlInput, setUrlInput] = useState("");
  const [source, setSource] = useState<VideoSource | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);

  const notes = useQuery({
    queryKey: ["notes", "video", source?.url],
    queryFn: () => api.listNotes({ sort: "updated_at", dir: "desc", limit: 50 }),
    enabled: !!source,
  });

  const videoNotes = (notes.data?.items ?? []).filter(
    (n) => n.source === "video" && n.source_url === source?.url,
  );

  useEffect(() => {
    let cancelled = false;
    async function mountYt() {
      if (!source || source.kind !== "youtube" || !ytHostRef.current) return;
      try {
        await loadYouTubeApi();
        if (cancelled || !ytHostRef.current) return;
        ytPlayerRef.current?.destroy();
        ytHostRef.current.innerHTML = "";
        const mount = document.createElement("div");
        ytHostRef.current.appendChild(mount);
        ytPlayerRef.current = new window.YT!.Player(mount, {
          videoId: source.id,
          playerVars: { rel: 0, modestbranding: 1 },
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Плеер недоступен");
      }
    }
    void mountYt();
    return () => {
      cancelled = true;
      try {
        ytPlayerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      ytPlayerRef.current = null;
    };
  }, [source]);

  function openUrl(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseVideoUrl(urlInput);
    if (!parsed) {
      setError("Некорректная ссылка");
      return;
    }
    setSource(parsed);
  }

  function currentSeconds(): number {
    if (source?.kind === "youtube" && ytPlayerRef.current) {
      try {
        return ytPlayerRef.current.getCurrentTime() || 0;
      } catch {
        return 0;
      }
    }
    return videoRef.current?.currentTime ?? 0;
  }

  function seekTo(ts: number) {
    if (source?.kind === "youtube" && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(ts, true);
      return;
    }
    if (videoRef.current) videoRef.current.currentTime = ts;
  }

  async function addAtCurrent() {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const ts = currentSeconds();
      const starts = new Date().toISOString();
      await api.createNote({
        title: title.trim() || `Заметка ${formatTimecode(ts)}`,
        body: body,
        starts_at: starts,
        reminder_offsets: [],
        source: "video",
        source_url: source.url,
        source_ts: ts,
        ai_generated: false,
      });
      setTitle("");
      setBody("");
      await qc.invalidateQueries({ queryKey: ["notes"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page capture-page video-page" data-testid="video-notes-page">
      <div className="page-head">
        <div>
          <h1>Заметки к видео</h1>
          <p className="mut">
            YouTube или другая ссылка на видео. Внешний плеер требует сеть. Таймкод — по явной кнопке.
          </p>
        </div>
      </div>

      <form className="card capture-card" onSubmit={openUrl}>
        <label className="lab">Ссылка на видео</label>
        <div className="capture-actions">
          <input
            data-testid="video-url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=… или прямой .mp4"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="submit" className="btn-accent" data-testid="video-open">
            Открыть
          </button>
        </div>
      </form>

      {source && (
        <div className="video-layout">
          <div className="video-player card">
            {source.kind === "youtube" ? (
              <div ref={ytHostRef} className="yt-host" data-testid="video-yt-host" />
            ) : (
              <video
                ref={videoRef}
                className="native-video"
                data-testid="video-native"
                src={source.url}
                controls
                playsInline
              />
            )}
          </div>
          <div className="video-notes-panel card">
            <label className="lab">Заметка к текущей секунде</label>
            <input
              data-testid="video-note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Заголовок"
            />
            <textarea
              data-testid="video-note-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Текст"
            />
            <button
              type="button"
              className="btn-accent"
              data-testid="video-note-at-time"
              disabled={busy}
              onClick={() => void addAtCurrent()}
            >
              Заметка к текущей секунде
            </button>
            {error && <p className="error">{error}</p>}
            <ul className="video-note-list" data-testid="video-note-list">
              {videoNotes.map((n: Note) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="timecode-link"
                    data-testid="video-timecode"
                    onClick={() => seekTo(n.source_ts ?? 0)}
                  >
                    {formatTimecode(n.source_ts ?? 0)}
                  </button>
                  <span>{n.title}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
