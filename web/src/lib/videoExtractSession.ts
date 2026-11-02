import { api, ExtractJob, ExtractResult } from "../api";
import { ExtractUiError, extractErrorFromJob, extractErrorFromUnknown } from "./extractErrors";

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

async function pollUntilDone(id: string, jobUrl: string, gen: number) {
  for (;;) {
    if (gen !== pollGen) return;
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
        emit({
          error: extractErrorFromJob(job),
          running: false,
          jobId: null,
          jobStep: null,
        });
        return;
      }
    } catch (err) {
      if (gen !== pollGen) return;
      const ui = extractErrorFromUnknown(err);
      if (ui.code !== "network" && ui.code !== "timeout") {
        emit({
          error: ui,
          running: false,
          jobId: null,
          jobStep: null,
        });
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
  emit({
    running: true,
    error: null,
    ready: null,
    url: youtubeUrl,
    jobStep: "queued",
    jobId: null,
  });
  try {
    const created = await api.startYoutubeExtractJob(youtubeUrl, timezone, {
      signal: ac.signal,
    });
    if (gen !== pollGen) return;
    emit({ jobId: created.id, jobStep: created.step });
    await pollUntilDone(created.id, youtubeUrl, gen);
  } catch (err) {
    if (gen !== pollGen) return;
    emit({
      error: extractErrorFromUnknown(err),
      running: false,
      jobId: null,
      jobStep: null,
    });
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
