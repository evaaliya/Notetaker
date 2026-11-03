import { api, ExtractJob, ExtractResult } from "../api";
import { BY_CODE, ExtractUiError, extractErrorFromJob, extractErrorFromUnknown } from "./extractErrors";

/** Wall-clock budget for the whole start+poll cycle (M21). */
export const EXTRACT_POLL_MAX_MS = 100_000;
/** Pending without worker heartbeat → surface worker error (M21 UI, ahead of 60s server TTL). */
export const EXTRACT_PENDING_WORKER_WARN_MS = 15_000;

export type VideoExtractReady = {
  result: ExtractResult;
  url: string;
};

export type VideoExtractSnapshot = {
  running: boolean;
  jobId: string | null;
  jobStep: string | null;
  url: string | null;
  error: ExtractUiError | null;
  ready: VideoExtractReady | null;
};

type Listener = () => void;

const listeners = new Set<Listener>();

let snapshot: VideoExtractSnapshot = {
  running: false,
  jobId: null,
  jobStep: null,
  url: null,
  error: null,
  ready: null,
};

let pollGen = 0;
let abortCtrl: AbortController | null = null;

function emit(next: Partial<VideoExtractSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

export function getVideoExtractSnapshot(): VideoExtractSnapshot {
  return snapshot;
}

export function subscribeVideoExtract(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function stopWithError(ui: ExtractUiError) {
  emit({
    error: ui,
    running: false,
    jobId: null,
    jobStep: null,
  });
}

async function pollUntilDone(id: string, jobUrl: string, gen: number, startedAt: number) {
  let pendingSince: number | null = null;
  for (;;) {
    if (gen !== pollGen) return;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= EXTRACT_POLL_MAX_MS) {
      stopWithError(BY_CODE.timeout);
      return;
    }
    try {
      // No AbortSignal on poll GETs — SPA nav / remount must not stop the loop.
      // Cancel bumps pollGen (+ aborts the initial POST only).
      const job: ExtractJob = await api.getExtractJob(id, { timeoutMs: 15_000 });
      if (gen !== pollGen) return;
      emit({ jobStep: job.step });
      if (job.status === "done" && job.result) {
        emit({
          ready: { result: job.result, url: jobUrl },
          running: false,
          jobId: null,
          jobStep: null,
        });
        return;
      }
      if (job.status === "error" || job.status === "cancelled") {
        stopWithError(extractErrorFromJob(job));
        return;
      }
      if (job.status === "pending") {
        if (pendingSince == null) pendingSince = Date.now();
        if (Date.now() - pendingSince >= EXTRACT_PENDING_WORKER_WARN_MS) {
          try {
            const cfg = await api.getExtractConfig({ timeoutMs: 5_000 });
            if (gen !== pollGen) return;
            if (!cfg.worker_ok) {
              stopWithError(BY_CODE.worker_unavailable);
              return;
            }
          } catch {
            /* keep polling — server TTL will fail the job */
          }
        }
      } else {
        pendingSince = null;
      }
    } catch (err) {
      if (gen !== pollGen) return;
      const ui = extractErrorFromUnknown(err);
      if (ui.code !== "network" && ui.code !== "timeout") {
        stopWithError(ui);
        return;
      }
    }
    await new Promise((r) => window.setTimeout(r, 700));
  }
}

export async function startVideoExtract(youtubeUrl: string, timezone?: string): Promise<void> {
  if (snapshot.running) return;
  abortCtrl?.abort();
  const ac = new AbortController();
  abortCtrl = ac;
  const gen = ++pollGen;
  const startedAt = Date.now();
  emit({
    running: true,
    error: null,
    ready: null,
    url: youtubeUrl,
    jobStep: "queued",
    jobId: null,
  });
  try {
    // Preflight: missing key / dead worker — fail before creating a job when possible.
    const cfg = await api.getExtractConfig({ signal: ac.signal, timeoutMs: 10_000 });
    if (gen !== pollGen) return;
    if (!cfg.configured) {
      stopWithError(BY_CODE.missing_ai_key);
      return;
    }
    if (!cfg.worker_ok) {
      stopWithError(BY_CODE.worker_unavailable);
      return;
    }
    const created = await api.startYoutubeExtractJob(youtubeUrl, timezone, {
      signal: ac.signal,
    });
    if (gen !== pollGen) return;
    emit({ jobId: created.id, jobStep: created.step });
    await pollUntilDone(created.id, youtubeUrl, gen, startedAt);
  } catch (err) {
    if (gen !== pollGen) return;
    stopWithError(extractErrorFromUnknown(err));
  }
}

export async function cancelVideoExtract(): Promise<void> {
  const id = snapshot.jobId;
  pollGen += 1;
  abortCtrl?.abort();
  abortCtrl = null;
  emit({
    running: false,
    jobStep: null,
    ready: null,
    jobId: null,
    error: {
      code: "cancelled",
      message: "Разбор отменён.",
      hint: "Нажмите «Разобрать субтитры», чтобы начать заново.",
    },
  });
  if (id) {
    try {
      await api.cancelExtractJob(id);
    } catch {
      /* ignore */
    }
  }
}

export function clearVideoExtractReady(): void {
  if (snapshot.ready) emit({ ready: null });
}

export function clearVideoExtractError(): void {
  if (snapshot.error) emit({ error: null });
}
