import { FormEvent, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ExtractConfig, ExtractDraft, ExtractResult, Note, User } from "../api";
import { NoteLink } from "../components/NoteLink";
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
import { useVideoExtractSession } from "../hooks/useVideoExtractSession";
import { BY_CODE, extractErrorFromUnknown, ExtractUiError } from "../lib/extractErrors";
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

function draftHasText(d: ExtractDraft | null | undefined): d is ExtractDraft {
  return !!(d?.title?.trim() && d?.body?.trim());
}

function configWarning(cfg: ExtractConfig | undefined): string | null {
  if (!cfg) return null;
  if (!cfg.configured) return BY_CODE.missing_ai_key.message;
  if (!cfg.worker_ok) return BY_CODE.worker_unavailable.message;
  return null;
}

/** Placeholder when the chosen language was not returned by the model (D-107). */
function missingLangDraft(lang: SummaryLang): ExtractDraft {
  if (lang === "ru") {
    return {
      title: "Русский вариант не получен",
      body: "Модель не вернула перевод. Выберите English или нажмите «Повторить».",
      starts_at: null,
      reminder_offsets: [],
      tag_names: [],
      kind: "summary",
    };
  }
  return {
    title: "English version not available",
    body: "The model did not return an English summary. Choose Русский or tap Retry.",
    starts_at: null,
    reminder_offsets: [],
    tag_names: [],
    kind: "summary",
  };
}

function applyJobResult(
  result: ExtractResult,
  setters: {
    setTranscript: (t: string | null) => void;
    setSummaryEn: (d: ExtractDraft | null) => void;
    setSummaryRu: (d: ExtractDraft | null) => void;
    setSummaryLang: (l: SummaryLang) => void;
    setSourceLang: (l: "en" | "ru" | "other") => void;
    setPending: (p: PendingDraft[]) => void;
    setConfirmOpen: (v: boolean) => void;
    setLocalError: (e: ExtractUiError | null) => void;
    setShowInCalendar?: (v: boolean) => void;
  },
) {
  setters.setTranscript(result.transcript ?? null);
  const sourceLang = result.source_lang === "ru" || result.source_lang === "en"
    ? result.source_lang
    : "other";
  setters.setSourceLang(sourceLang);

  // Map API fields → EN/RU slots by source language (not by “both present”).
  let en: ExtractDraft | null = null;
  let ru: ExtractDraft | null = null;
  if (sourceLang === "ru") {
    ru = draftHasText(result.summary)
      ? result.summary
      : draftHasText(result.summary_ru)
        ? result.summary_ru
        : null;
    en = null;
  } else {
    en = draftHasText(result.summary) ? result.summary : null;
    ru = draftHasText(result.summary_ru) ? result.summary_ru : null;
  }
  setters.setSummaryEn(en);
  setters.setSummaryRu(ru);

  // Default selection: RU source → ru; EN/other → en if present else ru.
  const initialLang: SummaryLang =
    sourceLang === "ru" ? "ru" : en ? "en" : "ru";
  setters.setSummaryLang(initialLang);

  const active =
    initialLang === "ru"
      ? ru ?? missingLangDraft("ru")
      : en ?? missingLangDraft("en");
  const rows = draftsFromExtract(active, result.drafts, {
    selectKinds: ["summary"],
  }).map((row) =>
    row.key === "summary-main" && !draftHasText(initialLang === "ru" ? ru : en)
      ? { ...row, selected: false }
      : row,
  );
  if (!rows.length) {
    setters.setLocalError({
      code: "model_no_response",
      message: "Субтитры получены, но черновиков не вышло.",
      hint: "Попробуйте другой ролик или нажмите «Повторить».",
    });
    return;
  }
  setters.setPending(rows);
  setters.setShowInCalendar?.(false);
  setters.setConfirmOpen(true);
}

export function VideoNotesPage({ user }: { user: User }) {
  const qc = useQueryClient();
  const extract = useVideoExtractSession();
  const [urlInput, setUrlInput] = useState("");
  const [source, setSource] = useState<VideoSource | null>(null);
  const [localError, setLocalError] = useState<ExtractUiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingDraft[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summaryEn, setSummaryEn] = useState<ExtractDraft | null>(null);
  const [summaryRu, setSummaryRu] = useState<ExtractDraft | null>(null);
  const [summaryLang, setSummaryLang] = useState<SummaryLang>("en");
  const [sourceLang, setSourceLang] = useState<"en" | "ru" | "other">("other");
  /** Video drafts: hide from calendar by default (M16 / D-096). */
  const [showInCalendar, setShowInCalendar] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);

  const uiError = localError ?? extract.error;

  const notes = useQuery({
    queryKey: ["notes", "video", source?.url],
    queryFn: () => api.listNotes({ sort: "updated_at", dir: "desc", limit: 50 }),
    enabled: !!source,
  });

  const extractConfig = useQuery({
    queryKey: ["extract-config"],
    queryFn: () => api.getExtractConfig(),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const videoNotes = (notes.data?.items ?? []).filter(
    (n) => n.source === "video" && n.source_url === source?.url,
  );

  const configWarn = configWarning(extractConfig.data);

  // Restore URL / player after navigating away mid-job (D-106).
  useEffect(() => {
    if (source || !extract.url) return;
    const parsed = parseVideoUrl(extract.url);
    if (!parsed) return;
    setSource(parsed);
    setUrlInput(extract.url);
  }, [extract.url, source]);

  // Open drafts modal only while this page is mounted. Keep session.ready until
  // the user dismisses/confirms so remount (nav away→back, Strict Mode) still shows it.
  useEffect(() => {
    if (!extract.ready) return;
    const { result, url } = extract.ready;
    const parsed = parseVideoUrl(url);
    if (parsed) {
      setSource(parsed);
      setUrlInput(url);
    }
    setLocalError(null);
    applyJobResult(result, {
      setTranscript,
      setSummaryEn,
      setSummaryRu,
      setSummaryLang,
      setSourceLang,
      setPending,
      setConfirmOpen,
      setLocalError,
      setShowInCalendar,
    });
  }, [extract.ready]);

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
        if (!cancelled) setLocalError(extractErrorFromUnknown(err));
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
    setLocalError(null);
    extract.clearError();
    const parsed = parseVideoUrl(urlInput);
    if (!parsed) {
      setLocalError({
        code: "validation_error",
        message: "Некорректная ссылка",
        hint: "Вставьте ссылку YouTube вида youtube.com/watch?v=…",
      });
      return;
    }
    setSource(parsed);
  }

  async function extractCaptions() {
    const url = source?.kind === "youtube" ? source.url : urlInput.trim();
    const parsed = parseVideoUrl(url);
    if (!parsed || parsed.kind !== "youtube") {
      setLocalError({
        code: "validation_error",
        message: "Субтитры доступны только для ссылок YouTube",
        hint: "Откройте ролик YouTube и нажмите «Разобрать субтитры».",
      });
      return;
    }
    if (!source) setSource(parsed);
    setLocalError(null);
    await extract.start(parsed.url, user.timezone);
  }

  async function confirmSelected() {
    const chosen = pending.filter((p) => p.selected);
    if (!chosen.length) {
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    setLocalError(null);
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
          show_in_calendar: showInCalendar,
        });
      }
      await qc.invalidateQueries({ queryKey: ["notes"] });
      await qc.invalidateQueries({ queryKey: ["calendar"] });
      setConfirmOpen(false);
      setPending([]);
      setTranscript(null);
      setSummaryEn(null);
      setSummaryRu(null);
      setShowInCalendar(false);
      extract.clearReady();
    } catch (err) {
      setLocalError(extractErrorFromUnknown(err));
    } finally {
      setBusy(false);
    }
  }

  function changeSummaryLang(lang: SummaryLang) {
    if (lang === "en" && sourceLang === "ru") return;
    setSummaryLang(lang);
    const real = lang === "ru" ? summaryRu : summaryEn;
    const next = real ?? missingLangDraft(lang);
    setPending((prev) => {
      const swapped = applySummaryLang(prev, next);
      if (real) return swapped;
      return swapped.map((row) =>
        row.key === "summary-main" ? { ...row, selected: false } : row,
      );
    });
  }

  const enDisabled = sourceLang === "ru";
  const activeHasText =
    summaryLang === "ru" ? draftHasText(summaryRu) : draftHasText(summaryEn);
  const langMissingHint = activeHasText
    ? null
    : summaryLang === "ru"
      ? "Русский вариант модель не вернула — создание этого конспекта отключено, пока не нажмёте «Повторить»."
      : "English-вариант модель не вернула — создание этого конспекта отключено, пока не нажмёте «Повторить».";

  const aiBusy = extract.running;
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
                onClick={() => void extract.cancel()}
              >
                Отменить
              </button>
            ) : null}
            {configWarn ? (
              <p className="muted small" data-testid="video-extract-config-warn" role="status">
                {configWarn}
              </p>
            ) : null}
          </div>
        </div>
        <AiThinkingPanel
          active={aiBusy}
          steps={VIDEO_EXTRACT_STEPS}
          currentStepId={extract.jobStep}
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
                <NoteLink noteId={n.id} className="video-note-link">
                  {n.title || "Без названия"}
                  {n.ai_generated ? <span className="ai-badge">создано ИИ</span> : null}
                </NoteLink>
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
          setShowInCalendar(false);
          extract.clearReady();
        }}
        onConfirm={() => void confirmSelected()}
        testId="video-drafts-modal"
        showLangChoice
        enDisabled={enDisabled}
        langMissingHint={langMissingHint}
        summaryLang={summaryLang}
        onSummaryLangChange={changeSummaryLang}
        showInCalendar={showInCalendar}
        onShowInCalendarChange={setShowInCalendar}
      />
    </div>
  );
}
