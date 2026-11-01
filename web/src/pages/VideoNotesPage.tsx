import { FormEvent, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ExtractDraft, ExtractJob, ExtractResult, Note, User } from "../api";
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
import { extractErrorFromJob, extractErrorFromUnknown, ExtractUiError } from "../lib/extractErrors";
import { parseVideoUrl, VideoSource } from "../lib/videoUrl";

type YTPlayer = {
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

function applyJobResult(result: ExtractResult, setters: {
  setTranscript: (t: string | null) => void;
  setSummaryEn: (d: ExtractDraft | null) => void;
  setSummaryRu: (d: ExtractDraft | null) => void;
  setSummaryLang: (l: SummaryLang) => void;
  setPending: (p: PendingDraft[]) => void;
  setConfirmOpen: (v: boolean) => void;
  setUiError: (e: ExtractUiError | null) => void;
}) {
  setters.setTranscript(result.transcript ?? null);
  const en = result.summary;
  const ru =
    result.summary_ru?.title?.trim() && result.summary_ru?.body?.trim()
      ? result.summary_ru
      : null;
  setters.setSummaryEn(en ?? null);
  setters.setSummaryRu(ru);
  const initialLang: SummaryLang = en && ru ? "en" : "ru";
  setters.setSummaryLang(initialLang);
  const activeSummary = initialLang === "ru" && ru ? ru : en;
  const rows = draftsFromExtract(activeSummary, result.drafts, {
    selectKinds: ["summary"],
  });
  if (!rows.length) {
    setters.setUiError({
      code: "model_no_response",
      message: "Субтитры получены, но черновиков не вышло.",
      hint: "Попробуйте другой ролик или нажмите «Повторить».",
    });
    return;
  }
  setters.setPending(rows);
  setters.setConfirmOpen(true);
}

export function VideoNotesPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const [urlInput, setUrlInput] = useState("");
  const [source, setSource] = useState<VideoSource | null>(null);
  const [uiError, setUiError] = useState<ExtractUiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [jobStep, setJobStep] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDraft[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summaryEn, setSummaryEn] = useState<ExtractDraft | null>(null);
  const [summaryRu, setSummaryRu] = useState<ExtractDraft | null>(null);
  const [summaryLang, setSummaryLang] = useState<SummaryLang>("en");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const pollGen = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

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
        if (!cancelled) setUiError(extractErrorFromUnknown(err));
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function openUrl(e: FormEvent) {
    e.preventDefault();
    setUiError(null);
    const parsed = parseVideoUrl(urlInput);
    if (!parsed) {
      setUiError({
        code: "validation_error",
        message: "Некорректная ссылка",
        hint: "Вставьте ссылку YouTube вида youtube.com/watch?v=…",
      });
      return;
    }
    setSource(parsed);
  }

  async function pollUntilDone(id: string, gen: number, signal: AbortSignal) {
    for (;;) {
      if (gen !== pollGen.current || signal.aborted) return;
      try {
        const job: ExtractJob = await api.getExtractJob(id, { signal, timeoutMs: 15_000 });
        if (gen !== pollGen.current) return;
        setJobStep(job.step);
        if (job.status === "done" && job.result) {
          applyJobResult(job.result, {
            setTranscript,
            setSummaryEn,
            setSummaryRu,
            setSummaryLang,
            setPending,
            setConfirmOpen,
            setUiError,
          });
          setAiBusy(false);
          setJobId(null);
          return;
        }
        if (job.status === "error" || job.status === "cancelled") {
          setUiError(extractErrorFromJob(job));
          setAiBusy(false);
          setJobId(null);
          return;
        }
      } catch (err) {
        if (gen !== pollGen.current || signal.aborted) return;
        // Network blip — keep polling; job state lives in DB (M14).
        const ui = extractErrorFromUnknown(err);
        if (ui.code !== "network" && ui.code !== "timeout") {
          setUiError(ui);
          setAiBusy(false);
          setJobId(null);
          return;
        }
      }
      await new Promise((r) => window.setTimeout(r, 700));
    }
  }

  async function extractCaptions() {
    if (aiBusy) return; // double-click guard (server also idempotent)
    const url = source?.kind === "youtube" ? source.url : urlInput.trim();
    const parsed = parseVideoUrl(url);
    if (!parsed || parsed.kind !== "youtube") {
      setUiError({
        code: "validation_error",
        message: "Субтитры доступны только для ссылок YouTube",
        hint: "Откройте ролик YouTube и нажмите «Разобрать субтитры».",
      });
      return;
    }
    if (!source) setSource(parsed);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++pollGen.current;
    setAiBusy(true);
    setUiError(null);
    setJobStep("queued");
    try {
      const created = await api.startYoutubeExtractJob(parsed.url, user.timezone, {
        signal: ac.signal,
      });
      if (gen !== pollGen.current) return;
      setJobId(created.id);
      setJobStep(created.step);
      await pollUntilDone(created.id, gen, ac.signal);
    } catch (err) {
      if (gen !== pollGen.current) return;
      setUiError(extractErrorFromUnknown(err));
      setAiBusy(false);
      setJobId(null);
    }
  }

  async function cancelJob() {
    const id = jobId;
    pollGen.current += 1;
    abortRef.current?.abort();
    setAiBusy(false);
    setJobStep(null);
    if (id) {
      try {
        await api.cancelExtractJob(id);
      } catch {
        /* ignore — UI already stopped */
      }
    }
    setJobId(null);
    setUiError({
      code: "cancelled",
      message: "Разбор отменён.",
      hint: "Нажмите «Разобрать субтитры», чтобы начать заново.",
    });
  }

  async function confirmSelected() {
    const chosen = pending.filter((p) => p.selected);
    if (!chosen.length) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    setUiError(null);
    try {
      const fallbackStarts = new Date().toISOString();
      for (const d of chosen) {
        await api.createNote({
          title: d.title,
          body: d.body,
          starts_at: d.starts_at || fallbackStarts,
          reminder_offsets: d.reminder_offsets || [],
          source: "video",
          source_url: source?.url ?? null,
          source_ts: null,
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
      setUiError(extractErrorFromUnknown(err));
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

  const canExtract =
    (source?.kind === "youtube" || parseVideoUrl(urlInput)?.kind === "youtube") && !aiBusy && !busy;

  return (
    <div className="page capture-page video-page" data-testid="video-notes-page">
      <div className="page-head">
        <div>
          <h1>Заметки к видео</h1>
          <p className="mut">
            Откройте ссылку и разберите субтитры YouTube (ИИ). Медиа и звук не скачиваем.
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

      <section className="card capture-card video-extract-card" data-testid="video-captions-extract">
        <label className="lab">Разобрать субтитры YouTube (ИИ)</label>
        <p className="muted small">
          Тянем текстовую дорожку субтитров с YouTube (ручные или авто), без скачивания ролика. Если
          субтитров нет — разобрать нельзя. Для прямых .mp4 субтитров нет.
        </p>
        <div className="video-extract-row">
          <div className="video-extract-player" data-testid="video-player-slot">
            {source ? (
              source.kind === "youtube" ? (
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
              )
            ) : (
              <div className="video-extract-placeholder muted small">
                Откройте ссылку выше — здесь появится плеер
              </div>
            )}
          </div>
          <div className="video-extract-actions">
            <button
              type="button"
              className="btn-accent"
              data-testid="video-extract-captions"
              disabled={!canExtract}
              onClick={() => void extractCaptions()}
            >
              {aiBusy ? "Думаю…" : "Разобрать субтитры"}
            </button>
            {aiBusy ? (
              <button
                type="button"
                className="btn-ghost"
                data-testid="video-extract-cancel"
                onClick={() => void cancelJob()}
              >
                Отменить
              </button>
            ) : null}
          </div>
        </div>
        <AiThinkingPanel
          active={aiBusy}
          steps={VIDEO_EXTRACT_STEPS}
          currentStepId={jobStep}
          title="Разбор субтитров"
          testId="video-ai-thinking"
        />
        {uiError && (
          <div className="extract-error" data-testid="video-extract-error" role="alert">
            <p className="error">{uiError.message}</p>
            <p className="muted small">{uiError.hint}</p>
            {uiError.code !== "cancelled" ? (
              <button
                type="button"
                className="btn-accent"
                data-testid="video-extract-retry"
                disabled={aiBusy || busy}
                onClick={() => void extractCaptions()}
              >
                Повторить
              </button>
            ) : null}
          </div>
        )}
      </section>

      {source && videoNotes.length > 0 ? (
        <section className="card capture-card" data-testid="video-note-list-wrap">
          <label className="lab">Заметки к этому видео</label>
          <ul className="video-note-list" data-testid="video-note-list">
            {videoNotes.map((n: Note) => (
              <li key={n.id}>
                <span>
                  {n.title}
                  {n.ai_generated ? <span className="ai-badge">создано ИИ</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
