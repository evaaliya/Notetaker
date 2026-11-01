import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ExtractDraft, ExtractResult, User } from "../api";
import {
  AiThinkingPanel,
  CALL_EXTRACT_STEPS,
} from "../components/AiThinkingPanel";

type SpeechRec = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRec;
    SpeechRecognition?: new () => SpeechRec;
  }
}

const CONSENT =
  "Звук не сохраняется на сервере. В зависимости от браузера он может обрабатываться сервисом его разработчика.";

type Pending = ExtractDraft & { selected: boolean; key: string };

export function CallCapturePage({ user }: { user: User }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const baseTextRef = useRef("");

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  function applyExtract(result: ExtractResult) {
    const rows: Pending[] = [];
    if (result.summary) {
      rows.push({ ...result.summary, selected: true, key: `summary-${result.summary.title}` });
    }
    result.drafts.forEach((d, i) => {
      rows.push({ ...d, selected: true, key: `d-${i}-${d.title}` });
    });
    setPending(rows);
    setConfirmOpen(true);
  }

  const extractGen = useRef(0);

  async function runExtract(e?: FormEvent) {
    e?.preventDefault();
    if (aiBusy) return;
    const gen = ++extractGen.current;
    setError(null);
    setAiBusy(true);
    try {
      const result = await api.extract(text, user.timezone);
      if (gen !== extractGen.current) return; // stale response
      applyExtract(result);
    } catch (err) {
      if (gen !== extractGen.current) return;
      setError(err instanceof Error ? err.message : "Ошибка extract");
    } finally {
      if (gen === extractGen.current) setAiBusy(false);
    }
  }

  async function onFile(file: File | null) {
    if (!file || aiBusy) return;
    const gen = ++extractGen.current;
    setError(null);
    setAiBusy(true);
    try {
      const result = await api.extractTranscriptFile(file, user.timezone);
      if (gen !== extractGen.current) return;
      applyExtract(result);
    } catch (err) {
      if (gen !== extractGen.current) return;
      setError(err instanceof Error ? err.message : "Ошибка файла");
    } finally {
      if (gen === extractGen.current) setAiBusy(false);
    }
  }

  function startSpeech() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Web Speech API недоступен в этом браузере");
      setConsentOpen(false);
      return;
    }
    setConsentOpen(false);
    setError(null);
    baseTextRef.current = text;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "ru-RU";
    rec.onresult = (ev) => {
      let finalChunk = "";
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalChunk) {
        baseTextRef.current = `${baseTextRef.current}${baseTextRef.current ? " " : ""}${finalChunk}`.trim();
      }
      const live = `${baseTextRef.current}${interim ? ` ${interim}` : ""}`.trim();
      setText(live);
    };
    rec.onerror = (ev) => {
      setError(`Распознавание: ${ev.error}`);
      setRecording(false);
    };
    rec.onend = () => {
      setRecording(false);
      recRef.current = null;
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }

  function stopSpeech() {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setRecording(false);
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
      for (const d of chosen) {
        await api.createNote({
          title: d.title,
          body: d.body,
          starts_at: d.starts_at || fallbackStarts,
          reminder_offsets: d.reminder_offsets || [],
          source: "call",
          ai_generated: true,
        });
      }
      await qc.invalidateQueries({ queryKey: ["notes"] });
      setConfirmOpen(false);
      navigate("/list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page capture-page" data-testid="call-capture-page">
      <div className="page-head">
        <div>
          <h1>Конспект звонка</h1>
          <p className="mut">
            Импорт транскрипта (.txt / .vtt / .srt) или живое распознавание в браузере — без записи на
            сервер. Zoom сами не подключаемся: если у звонка есть captions/transcript, экспортируйте
            файл в Zoom и загрузите сюда.
          </p>
        </div>
      </div>

      <section className="card capture-card">
        <label className="lab">Транскрипт (.txt, .vtt, .srt)</label>
        <input
          type="file"
          accept=".txt,.vtt,.srt,text/plain,text/vtt"
          data-testid="call-transcript-file"
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
        <label className="lab" style={{ marginTop: "var(--space-4)" }}>
          Или вставьте текст
        </label>
        <textarea
          data-testid="call-transcript-text"
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Вставьте текст звонка…"
        />
        <div className="capture-actions">
          {!recording ? (
            <button
              type="button"
              className="secondary"
              data-testid="call-start-speech"
              onClick={() => setConsentOpen(true)}
            >
              Начать конспект звонка
            </button>
          ) : (
            <button
              type="button"
              className="btn-danger"
              data-testid="call-stop-speech"
              onClick={stopSpeech}
            >
              Остановить
            </button>
          )}
          {recording && (
            <span className="recording-pill" data-testid="call-recording-indicator" role="status">
              Идёт запись
            </span>
          )}
          <button
            type="button"
            className="btn-accent"
            data-testid="call-extract"
            disabled={busy || aiBusy || !text.trim()}
            onClick={() => void runExtract()}
          >
            {aiBusy ? "Думаю…" : "Извлечь черновики"}
          </button>
        </div>
        <AiThinkingPanel
          active={aiBusy}
          steps={CALL_EXTRACT_STEPS}
          title="Разбор транскрипта"
          testId="call-ai-thinking"
        />
        {error && <p className="error">{error}</p>}
      </section>

      {consentOpen && (
        <div className="modal-backdrop" role="presentation" data-testid="call-consent-modal">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="call-consent-title">
            <h2 id="call-consent-title">Согласие на распознавание</h2>
            <p>{CONSENT}</p>
            <div className="capture-actions">
              <button type="button" className="secondary" onClick={() => setConsentOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn-accent" data-testid="call-consent-ok" onClick={startSpeech}>
                Разрешить и начать
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="modal-backdrop" role="presentation" data-testid="call-drafts-modal">
          <div className="modal-card modal-wide" role="dialog" aria-modal="true">
            <h2>Подтвердите черновики</h2>
            <p className="muted">Ничего не создаётся, пока вы не подтвердите. У заметок будет метка «создано ИИ».</p>
            <ul className="draft-list" data-testid="call-draft-list">
              {pending.map((d) => (
                <li key={d.key}>
                  <label className="draft-row">
                    <input
                      type="checkbox"
                      checked={d.selected}
                      onChange={(e) =>
                        setPending((prev) =>
                          prev.map((x) => (x.key === d.key ? { ...x, selected: e.target.checked } : x)),
                        )
                      }
                    />
                    <span>
                      <strong>{d.title}</strong>
                      <span className="ai-badge">создано ИИ</span>
                      <span className="muted small"> · {d.kind}</span>
                      <div className="muted small">{d.body.slice(0, 160)}</div>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="capture-actions">
              <button type="button" className="secondary" onClick={() => setConfirmOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn-accent"
                data-testid="call-confirm-drafts"
                disabled={busy}
                onClick={() => void confirmSelected()}
              >
                Создать выбранные
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
