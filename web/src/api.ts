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
  reminder_id: string;
};

export type RealtimeEvent = {
  type: string;
  ids?: string[];
  version?: number;
  title?: string;
  body?: string;
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

type ErrorBody = { error?: { code?: string; message?: string }; note?: Note };

export class ApiError extends Error {
  status: number;
  code?: string;
  note?: Note;

  constructor(status: number, message: string, code?: string, note?: Note) {
    super(message);
    this.status = status;
    this.code = code;
    this.note = note;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    let note: Note | undefined;
    try {
      const body = (await res.json()) as ErrorBody;
      message = body.error?.message || message;
      code = body.error?.code;
      note = body.note;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message, code, note);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

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
  getNote: (id: string) => request<Note>(`/api/notes/${id}`),
  createNote: (body: Record<string, unknown>) =>
    request<Note>("/api/notes", { method: "POST", body: JSON.stringify(body) }),
  patchNote: (
    id: string,
    body: Record<string, unknown>,
    opts?: { scope?: EditScope; occurrence_start?: string },
  ) => {
    const sp = new URLSearchParams();
    if (opts?.scope) sp.set("scope", opts.scope);
    if (opts?.occurrence_start) sp.set("occurrence_start", opts.occurrence_start);
    const q = sp.toString();
    return request<Note>(`/api/notes/${id}${q ? `?${q}` : ""}`, {
      method: "PATCH",
      body: JSON.stringify(body),
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
};
