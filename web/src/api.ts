export type User = {
  id: string;
  login: string;
  email: string | null;
  timezone: string;
  created_at: string;
};

export type Tag = {
  id: string;
  name: string;
  color: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  starts_at: string;
  status: "active" | "inactive";
  reminder_offsets: number[];
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  tag_ids: string[];
  rec_freq: string | null;
  rec_until: string | null;
  rec_tz: string | null;
  has_attachments?: boolean;
  owner_login?: string | null;
  role?: "owner" | "editor" | null;
  updated_by_login?: string | null;
  source?: "manual" | "call" | "video";
  source_url?: string | null;
  source_ts?: number | null;
  ai_generated?: boolean;
  show_in_calendar?: boolean;
};

export type ExtractDraft = {
  title: string;
  body: string;
  starts_at: string | null;
  reminder_offsets: number[];
  tag_names: string[];
  kind: "summary" | "task" | "decision";
};

export type ExtractResult = {
  summary: ExtractDraft | null;
  drafts: ExtractDraft[];
  provider: string;
  transcript?: string | null;
  source_lang?: "en" | "ru" | "other" | null;
  /** Russian twin of summary when source_lang is en (language choice in UI). */
  summary_ru?: ExtractDraft | null;
};

export type NoteMember = {
  user_id: string;
  login: string;
  role: "owner" | "editor";
  created_at: string;
};

export type Attachment = {
  id: string;
  note_id: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: string;
};

export type NoteList = {
  items: Note[];
  next_cursor: string | null;
};

export type Occurrence = {
  /** Effective start (calendar position). */
  occurrence_start: string;
  /** Series key for overrides; equals occurrence_start if not moved. */
  original_start: string;
  note: Note;
};

export type EditScope = "this" | "following" | "all";

export type Recurrence = {
  freq: "daily" | "weekly" | "monthly";
  until?: string | null;
  tz: string;
};

export type CalendarList = {
  items: Occurrence[];
};

export type Upcoming = {
  today: Occurrence[];
  week: Occurrence[];
  past: Occurrence[];
};

export type Notification = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  seen_at: string | null;
  reminder_id: string | null;
  note_id: string | null;
};

export type RealtimeEvent = {
  type: string;
  ids?: string[];
  version?: number;
  title?: string;
  body?: string;
  note_id?: string;
};

export type NoteListParams = {
  q?: string;
  tags?: string[];
  tag_mode?: "any" | "all";
  status?: string;
  from?: string;
  to?: string;
  sort?: "starts_at" | "updated_at";
  dir?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

type ErrorBody = {
  error?: { code?: string; message?: string; hint?: string };
  hint?: string;
  note?: Note;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  note?: Note;
  hint?: string;

  constructor(status: number, message: string, code?: string, note?: Note, hint?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.note = note;
    this.hint = hint;
  }
}

export type RequestOpts = RequestInit & {
  /** Wall-clock abort; default 30s. Pass 0 to disable. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

function mergeAbortSignals(
  timeoutMs: number,
  external?: AbortSignal | null,
): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer =
    timeoutMs > 0
      ? window.setTimeout(() => ctrl.abort(new DOMException("timeout", "AbortError")), timeoutMs)
      : undefined;
  const onExt = () => ctrl.abort(external?.reason);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", onExt, { once: true });
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExt);
    },
  };
}

async function request<T>(path: string, init?: RequestOpts): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { timeoutMs: _t, signal: outerSignal, ...rest } = init ?? {};
  const { signal, cancel } = mergeAbortSignals(timeoutMs, outerSignal);
  try {
    const isForm = typeof FormData !== "undefined" && rest.body instanceof FormData;
    const headers: HeadersInit = isForm
      ? { ...(rest.headers || {}) }
      : { "Content-Type": "application/json", ...(rest.headers || {}) };
    const res = await fetch(path, {
      credentials: "include",
      ...rest,
      headers,
      signal,
    });
    if (!res.ok) {
      let message = res.statusText;
      let code: string | undefined;
      let note: Note | undefined;
      let hint: string | undefined;
      try {
        const body = (await res.json()) as ErrorBody;
        message = body.error?.message || message;
        code = body.error?.code;
        note = body.note;
        hint = body.hint || body.error?.hint;
        if (res.status >= 500 && !code) code = "upstream_error";
      } catch {
        if (res.status >= 500) {
          message = "Сервер временно недоступен";
          code = "upstream_error";
          hint = "Подождите и нажмите «Повторить».";
        }
      }
      throw new ApiError(res.status, message, code, note, hint);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const aborted =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError");
    if (aborted) {
      const reason = String((err as { message?: string })?.message || "");
      if (reason === "timeout" || outerSignal?.aborted !== true) {
        throw new ApiError(
          0,
          "Превышено время ожидания ответа сервера",
          "timeout",
          undefined,
          "Проверьте сеть и нажмите «Повторить».",
        );
      }
      throw new ApiError(0, "Запрос отменён", "cancelled");
    }
    throw new ApiError(
      0,
      "Нет сети или сервер недоступен",
      "network",
      undefined,
      "Проверьте интернет и повторите действие.",
    );
  } finally {
    cancel();
  }
}

export type ExtractJobStatus = "pending" | "running" | "done" | "error" | "cancelled";
export type ExtractJobStep = "queued" | "captions" | "extract" | "done";

export type ExtractJob = {
  id: string;
  status: ExtractJobStatus;
  step: ExtractJobStep;
  video_id: string | null;
  error_code: string | null;
  error_message: string | null;
  error_hint: string | null;
  result: ExtractResult | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type ExtractJobCreated = {
  id: string;
  status: string;
  step: string;
  video_id: string | null;
  reused: boolean;
};

export type ExtractConfig = {
  provider: string;
  configured: boolean;
  worker_ok: boolean;
};

function notesQuery(params: NoteListParams): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.tags) params.tags.forEach((t) => sp.append("tags", t));
  if (params.tag_mode) sp.set("tag_mode", params.tag_mode);
  if (params.status) sp.set("status", params.status);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.sort) sp.set("sort", params.sort);
  if (params.dir) sp.set("dir", params.dir);
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.limit != null) sp.set("limit", String(params.limit));
  const q = sp.toString();
  return q ? `?${q}` : "";
}

export const api = {
  register: (login: string, password: string, timezone?: string) =>
    request<User>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        login,
        password,
        ...(timezone ? { timezone } : {}),
      }),
    }),
  login: (login: string, password: string) =>
    request<User>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    }),
  logout: () => request<{ status: string }>("/api/auth/logout", { method: "POST" }),
  me: () => request<User>("/api/me"),
  patchMe: (body: { email?: string | null; timezone?: string }) =>
    request<User>("/api/me", { method: "PATCH", body: JSON.stringify(body) }),

  listTags: () => request<Tag[]>("/api/tags"),
  createTag: (body: { name: string; color: string }) =>
    request<Tag>("/api/tags", { method: "POST", body: JSON.stringify(body) }),
  patchTag: (id: string, body: { name?: string; color?: string }) =>
    request<Tag>(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTag: (id: string) => request<void>(`/api/tags/${id}`, { method: "DELETE" }),

  listNotes: (params: NoteListParams = {}) =>
    request<NoteList>(`/api/notes${notesQuery(params)}`),
  getNote: (id: string, opts?: RequestOpts) =>
    request<Note>(`/api/notes/${id}`, opts),
  createNote: (body: Record<string, unknown>, opts?: RequestOpts) =>
    request<Note>("/api/notes", {
      method: "POST",
      body: JSON.stringify(body),
      ...opts,
    }),
  patchNote: (
    id: string,
    body: Record<string, unknown>,
    opts?: { scope?: EditScope; occurrence_start?: string } & RequestOpts,
  ) => {
    const sp = new URLSearchParams();
    if (opts?.scope) sp.set("scope", opts.scope);
    if (opts?.occurrence_start) sp.set("occurrence_start", opts.occurrence_start);
    const { scope: _s, occurrence_start: _o, ...reqOpts } = opts ?? {};
    const q = sp.toString();
    return request<Note>(`/api/notes/${id}${q ? `?${q}` : ""}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      ...reqOpts,
    });
  },
  deleteNote: (
    id: string,
    opts?: { scope?: EditScope; occurrence_start?: string },
  ) => {
    const sp = new URLSearchParams();
    if (opts?.scope) sp.set("scope", opts.scope);
    if (opts?.occurrence_start) sp.set("occurrence_start", opts.occurrence_start);
    const q = sp.toString();
    return request<Note>(`/api/notes/${id}${q ? `?${q}` : ""}`, { method: "DELETE" });
  },
  activateNote: (id: string) =>
    request<Note>(`/api/notes/${id}/activate`, { method: "POST" }),
  deactivateNote: (id: string) =>
    request<Note>(`/api/notes/${id}/deactivate`, { method: "POST" }),
  trash: () => request<Note[]>("/api/notes/trash"),
  restoreNote: (id: string) =>
    request<Note>(`/api/notes/${id}/restore`, { method: "POST" }),

  listMembers: (noteId: string) =>
    request<NoteMember[]>(`/api/notes/${noteId}/members`),
  addMember: (noteId: string, login: string) =>
    request<NoteMember>(`/api/notes/${noteId}/members`, {
      method: "POST",
      body: JSON.stringify({ login }),
    }),
  removeMember: (noteId: string, userId: string) =>
    request<void>(`/api/notes/${noteId}/members/${userId}`, { method: "DELETE" }),
  leaveNote: (noteId: string) =>
    request<void>(`/api/notes/${noteId}/members/me/leave`, { method: "POST" }),

  listAttachments: (noteId: string) =>
    request<Attachment[]>(`/api/notes/${noteId}/attachments`),
  uploadAttachment: async (
    noteId: string,
    file: File,
    onProgress?: (pct: number) => void,
    clientId?: string,
  ): Promise<Attachment> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/notes/${noteId}/attachments`);
      xhr.withCredentials = true;
      xhr.timeout = 60_000;
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && onProgress) {
          onProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
        let message = xhr.statusText;
        let code: string | undefined;
        try {
          const body = JSON.parse(xhr.responseText) as ErrorBody & Attachment;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(body as Attachment);
            return;
          }
          message = body.error?.message || message;
          code = body.error?.code;
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, message, code));
      };
      xhr.onerror = () =>
        reject(
          new ApiError(0, "Нет сети или сервер недоступен", "network", undefined, "Проверьте интернет и повторите."),
        );
      xhr.ontimeout = () =>
        reject(
          new ApiError(0, "Превышено время ожидания загрузки файла", "timeout", undefined, "Повторите загрузку."),
        );
      const fd = new FormData();
      fd.append("file", file);
      if (clientId) fd.append("client_id", clientId);
      xhr.send(fd);
    });
  },
  attachmentUrl: (noteId: string, attachmentId: string) =>
    `/api/notes/${noteId}/attachments/${attachmentId}`,
  deleteAttachment: (noteId: string, attachmentId: string) =>
    request<void>(`/api/notes/${noteId}/attachments/${attachmentId}`, {
      method: "DELETE",
    }),

  calendar: (from: string, to: string) =>
    request<CalendarList>(
      `/api/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  upcoming: () => request<Upcoming>("/api/upcoming"),

  listNotifications: (unseen?: boolean) =>
    request<Notification[]>(
      unseen ? "/api/notifications?unseen=1" : "/api/notifications",
    ),
  markNotificationSeen: (id: string) =>
    request<Notification>(`/api/notifications/${id}/seen`, { method: "POST" }),

  e2eMakeReminderDue: (noteId: string) =>
    request<{ updated: number }>("/api/e2e/make_reminder_due", {
      method: "POST",
      body: JSON.stringify({ note_id: noteId }),
    }),
  e2eTickReminders: () =>
    request<{ claimed: number }>("/api/e2e/tick_reminders", { method: "POST" }),

  extract: (text: string, timezone?: string, opts?: RequestOpts) =>
    request<ExtractResult>("/api/extract", {
      method: "POST",
      body: JSON.stringify({ text, ...(timezone ? { timezone } : {}) }),
      timeoutMs: 90_000,
      ...opts,
    }),
  extractTranscriptFile: async (
    file: File,
    timezone?: string,
    opts?: RequestOpts,
  ): Promise<ExtractResult> => {
    const fd = new FormData();
    fd.append("file", file);
    if (timezone) fd.append("timezone", timezone);
    return request<ExtractResult>("/api/extract/transcript", {
      method: "POST",
      body: fd,
      headers: {}, // let browser set multipart boundary
      timeoutMs: 90_000,
      ...opts,
    });
  },
  /** Sync YouTube extract (compat / tests). Prefer startYoutubeExtractJob + poll. */
  extractYoutube: (url: string, timezone?: string, opts?: RequestOpts) =>
    request<ExtractResult>("/api/extract/youtube", {
      method: "POST",
      body: JSON.stringify({ url, ...(timezone ? { timezone } : {}) }),
      timeoutMs: 100_000,
      ...opts,
    }),
  getExtractConfig: (opts?: RequestOpts) =>
    request<ExtractConfig>("/api/extract/config", { timeoutMs: 10_000, ...opts }),
  startYoutubeExtractJob: (url: string, timezone?: string, opts?: RequestOpts) =>
    request<ExtractJobCreated>("/api/extract/youtube/jobs", {
      method: "POST",
      body: JSON.stringify({ url, ...(timezone ? { timezone } : {}) }),
      timeoutMs: 15_000,
      ...opts,
    }),
  getExtractJob: (jobId: string, opts?: RequestOpts) =>
    request<ExtractJob>(`/api/extract/jobs/${jobId}`, { timeoutMs: 15_000, ...opts }),
  cancelExtractJob: (jobId: string, opts?: RequestOpts) =>
    request<ExtractJob>(`/api/extract/jobs/${jobId}/cancel`, {
      method: "POST",
      timeoutMs: 15_000,
      ...opts,
    }),
};
