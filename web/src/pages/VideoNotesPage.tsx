import { FormEvent, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ExtractDraft, Note, User } from "../api";
import {
  AiThinkingPanel,
  VIDEO_EXTRACT_STEPS,
} from "../components/AiThinkingPanel";
import {
  applySummaryLang,
  draftsFromExtract,
  ExtractDraftsModal,
  PendingDraft,
  SummaryLang,
} from "../components/ExtractDraftsModal";
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

export function VideoNotesPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const [urlInput, setUrlInput] = useState("");
  const [source, setSource] = useState<VideoSource | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [pending, setPending] = useState<PendingDraft[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summaryEn, setSummaryEn] = useState<ExtractDraft | null>(null);
  const [summaryRu, setSummaryRu] = useState<ExtractDraft | null>(null);
  const [summaryLang, setSummaryLang] = useState<SummaryLang>("en");
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

  async function extractCaptions() {
    const url = source?.kind === "youtube" ? source.url : urlInput.trim();
    const parsed = parseVideoUrl(url);
    if (!parsed || parsed.kind !== "youtube") {
      setError("Субтитры доступны только для ссылок YouTube");
      return;
    }
    if (!source) setSource(parsed);
    setAiBusy(true);
    setError(null);
    try {
      const result = await api.extractYoutube(parsed.url, user.timezone);
      setTranscript(result.transcript ?? null);
      const en = result.summary;
      const ru =
        result.source_lang === "en" && result.summary_ru?.title && result.summary_ru?.body
          ? result.summary_ru
          : null;
      setSummaryEn(en);
      setSummaryRu(ru);
      // Prefer original language for English sources; RU-only talks stay on Russian summary.
      const initialLang: SummaryLang = en && result.source_lang === "en" ? "en" : "ru";
      setSummaryLang(initialLang);
      const activeSummary = initialLang === "ru" && ru ? ru : en;
      // Video: one lecture → one note by default; task/decision splinters stay unchecked (D-069).
      const rows = draftsFromExtract(activeSummary, result.drafts, {
        selectKinds: ["summary"],
      });
      if (!rows.length) {
        setError("Субтитры получены, но черновиков не вышло. Попробуйте другой ролик.");
        return;
      }
      setPending(rows);
      setConfirmOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось взять субтитры");
    } finally {
      setAiBusy(false);
    }
  }

  async function confirmSelected() {
    const chosen = pending.filter((p) => p.selected);
    if (!chosen.length) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fallbackStarts = new Date().toISOString();
      const ts = currentSeconds();
      for (const d of chosen) {
        await api.createNote({
          title: d.title,
          body: d.body,
          starts_at: d.starts_at || fallbackStarts,
          reminder_offsets: d.reminder_offsets || [],
          source: "video",
          source_url: source?.url ?? null,
          source_ts: source ? ts : null,
          ai_generated: true,
        });
      }
      await qc.invalidateQueries({ queryKey: ["notes"] });
      setConfirmOpen(false);
      setPending([]);
      setTranscript(null);
      setSummaryEn(null);
      setSummaryRu(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
    } finally {
      setBusy(false);
    }
  }

  function changeSummaryLang(lang: SummaryLang) {
    setSummaryLang(lang);
    const next = lang === "ru" ? summaryRu : summaryEn;
    if (!next) return;
    setPending((prev) => applySummaryLang(prev, next));
  }

  return (
    <div className="page capture-page video-page" data-testid="video-notes-page">
      <div className="page-head">
        <div>
          <h1>Заметки к видео</h1>
          <p className="mut">
            Плеер + ручные таймкоды. ИИ: субтитры YouTube (если есть) → черновики. Медиа и звук не
            скачиваем.
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

      <section className="card capture-card" data-testid="video-captions-extract">
        <label className="lab">Разобрать субтитры YouTube (ИИ)</label>
        <p className="muted small">
          Тянем текстовую дорожку субтитров с YouTube (ручные или авто), без скачивания ролика. Если
          субтитров нет — разобрать нельзя. Для прямых .mp4 субтитров нет.
        </p>
        <div className="capture-actions">
          <button
            type="button"
            className="btn-accent"
            data-testid="video-extract-captions"
            disabled={busy || aiBusy}
            onClick={() => void extractCaptions()}
          >
            {aiBusy ? "Думаю…" : "Разобрать субтитры"}
          </button>
        </div>
        <AiThinkingPanel
          active={aiBusy}
          steps={VIDEO_EXTRACT_STEPS}
          title="Разбор субтитров"
          testId="video-ai-thinking"
        />
        {error && <p className="error">{error}</p>}
      </section>

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
                  <span>
                    {n.title}
                    {n.ai_generated ? <span className="ai-badge">создано ИИ</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ExtractDraftsModal
        open={confirmOpen}
        pending={pending}
        transcript={transcript}
        busy={busy}
        onChange={setPending}
        onCancel={() => {
          setConfirmOpen(false);
          setSummaryEn(null);
          setSummaryRu(null);
        }}
        onConfirm={() => void confirmSelected()}
        testId="video-drafts-modal"
        bilingual={!!(summaryEn && summaryRu)}
        summaryLang={summaryLang}
        onSummaryLangChange={changeSummaryLang}
      />
    </div>
  );
}
