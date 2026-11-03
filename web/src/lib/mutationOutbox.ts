/**
 * Durable mutation outbox in IndexedDB (M22 / D-119).
 * Survives reload; single-tab flush via Web Locks; online + backoff.
 */

import { ApiError, api, type Note } from "../api";

const DB_NAME = "notetaker-outbox";
const DB_VERSION = 1;
const STORE = "ops";
const LOCK_NAME = "notetaker-outbox-flush";

export type OutboxOp =
  | {
      id: string;
      kind: "create";
      clientNoteId: string;
      body: Record<string, unknown>;
      createdAt: number;
    }
  | {
      id: string;
      kind: "patch";
      noteId: string;
      body: Record<string, unknown>;
      createdAt: number;
    }
  | {
      id: string;
      kind: "delete";
      noteId: string;
      createdAt: number;
    }
  | {
      id: string;
      kind: "restore";
      noteId: string;
      createdAt: number;
    }
  | {
      id: string;
      kind: "upload";
      noteId: string;
      clientId: string;
      name: string;
      type: string;
      lastModified: number;
      blob: Blob;
      createdAt: number;
    };

type Listener = () => void;

const listeners = new Set<Listener>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 1000;
let started = false;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("outbox open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("outbox request failed"));
  });
}

function notify() {
  for (const l of listeners) l();
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function listOutbox(): Promise<OutboxOp[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const rows = (await idbReq(tx.objectStore(STORE).getAll())) as OutboxOp[];
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

export async function outboxPendingCount(): Promise<number> {
  return (await listOutbox()).length;
}

async function putOp(op: OutboxOp): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(op);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("outbox put failed"));
    });
  } finally {
    db.close();
  }
  notify();
  scheduleFlush(0);
}

async function removeOp(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("outbox delete failed"));
    });
  } finally {
    db.close();
  }
  notify();
}

/** Enqueue create; coalesce with existing create for same clientNoteId. */
export async function enqueueCreate(
  clientNoteId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const ops = await listOutbox();
  const existing = ops.find((o) => o.kind === "create" && o.clientNoteId === clientNoteId);
  if (existing && existing.kind === "create") {
    await putOp({
      ...existing,
      body: { ...body, id: clientNoteId },
    });
    return;
  }
  // Drop pending patches/uploads/deletes for this client id that cannot run yet.
  for (const o of ops) {
    if (o.kind === "patch" && o.noteId === clientNoteId) await removeOp(o.id);
    if (o.kind === "delete" && o.noteId === clientNoteId) {
      // delete before create → cancel create entirely
      await removeOp(o.id);
      return;
    }
  }
  await putOp({
    id: crypto.randomUUID(),
    kind: "create",
    clientNoteId,
    body: { ...body, id: clientNoteId },
    createdAt: Date.now(),
  });
}

/** Coalesce PATCH: last-write-wins per noteId (D-119). */
export async function enqueuePatch(
  noteId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const ops = await listOutbox();
  const create = ops.find((o) => o.kind === "create" && o.clientNoteId === noteId);
  if (create && create.kind === "create") {
    // Fold into create body (note not on server yet).
    const { version: _v, ...rest } = body;
    await putOp({
      ...create,
      body: { ...create.body, ...rest, id: noteId },
    });
    return;
  }
  const existing = ops.find((o) => o.kind === "patch" && o.noteId === noteId);
  if (existing && existing.kind === "patch") {
    await putOp({
      ...existing,
      body: { ...existing.body, ...body },
    });
    return;
  }
  await putOp({
    id: crypto.randomUUID(),
    kind: "patch",
    noteId,
    body,
    createdAt: Date.now(),
  });
}

export async function enqueueDelete(noteId: string): Promise<void> {
  const ops = await listOutbox();
  const create = ops.find((o) => o.kind === "create" && o.clientNoteId === noteId);
  if (create) {
    await removeOp(create.id);
    for (const o of ops) {
      if (o.kind === "patch" && o.noteId === noteId) await removeOp(o.id);
      if (o.kind === "upload" && o.noteId === noteId) await removeOp(o.id);
    }
    return;
  }
  for (const o of ops) {
    if (o.kind === "patch" && o.noteId === noteId) await removeOp(o.id);
    if (o.kind === "upload" && o.noteId === noteId) await removeOp(o.id);
    if (o.kind === "restore" && o.noteId === noteId) await removeOp(o.id);
  }
  const existing = ops.find((o) => o.kind === "delete" && o.noteId === noteId);
  if (existing) return;
  await putOp({
    id: crypto.randomUUID(),
    kind: "delete",
    noteId,
    createdAt: Date.now(),
  });
}

export async function enqueueRestore(noteId: string): Promise<void> {
  const ops = await listOutbox();
  for (const o of ops) {
    if (o.kind === "delete" && o.noteId === noteId) await removeOp(o.id);
  }
  const existing = ops.find((o) => o.kind === "restore" && o.noteId === noteId);
  if (existing) return;
  await putOp({
    id: crypto.randomUUID(),
    kind: "restore",
    noteId,
    createdAt: Date.now(),
  });
}

export async function enqueueUpload(
  noteId: string,
  clientId: string,
  file: File,
): Promise<void> {
  const ops = await listOutbox();
  if (ops.some((o) => o.kind === "upload" && o.clientId === clientId)) return;
  await putOp({
    id: crypto.randomUUID(),
    kind: "upload",
    noteId,
    clientId,
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    blob: file,
    createdAt: Date.now(),
  });
}

function isRetriable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.code === "network" || err.code === "timeout";
}

async function runOp(op: OutboxOp): Promise<Note | null> {
  switch (op.kind) {
    case "create": {
      const note = await api.createNote(op.body, { timeoutMs: 15_000 });
      return note;
    }
    case "patch": {
      const note = await api.patchNote(op.noteId, op.body, { timeoutMs: 15_000 });
      return note;
    }
    case "delete":
      await api.deleteNote(op.noteId);
      return null;
    case "restore":
      await api.restoreNote(op.noteId);
      return null;
    case "upload": {
      const file = new File([op.blob], op.name, {
        type: op.type || undefined,
        lastModified: op.lastModified,
      });
      await api.uploadAttachment(op.noteId, file, undefined, op.clientId);
      return null;
    }
    default:
      return null;
  }
}

async function flushOnce(): Promise<{ flushed: number; created?: Note }> {
  const ops = await listOutbox();
  if (!ops.length) {
    backoffMs = 1000;
    return { flushed: 0 };
  }
  let flushed = 0;
  let created: Note | undefined;
  for (const op of ops) {
    try {
      const note = await runOp(op);
      await removeOp(op.id);
      flushed += 1;
      if (op.kind === "create" && note) created = note;
      backoffMs = 1000;
    } catch (err) {
      if (op.kind === "patch" && err instanceof ApiError && err.status === 409 && err.note) {
        // Last-write-wins: retry once with server version (D-119).
        try {
          const { version: _v, ...rest } = op.body;
          await api.patchNote(op.noteId, { version: err.note.version, ...rest });
          await removeOp(op.id);
          flushed += 1;
          backoffMs = 1000;
          continue;
        } catch (err2) {
          if (!isRetriable(err2)) {
            await removeOp(op.id);
            throw err2;
          }
          throw err2;
        }
      }
      if (!isRetriable(err)) {
        // Drop non-retriable to avoid poison pill; surface via notify.
        await removeOp(op.id);
        throw err;
      }
      throw err;
    }
  }
  return { flushed, created };
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  return locks.request(LOCK_NAME, fn);
}

export async function flushOutbox(): Promise<{ flushed: number; created?: Note }> {
  return withLock(async () => {
    try {
      return await flushOnce();
    } catch {
      scheduleFlush(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
      return { flushed: 0 };
    }
  });
}

export function scheduleFlush(delayMs = 0): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void flushOutbox();
  }, delayMs);
}

/** Start online/visibility listeners once (call from App shell). */
export function startOutboxPump(): () => void {
  if (started) return () => undefined;
  started = true;
  const onOnline = () => scheduleFlush(0);
  const onVis = () => {
    if (document.visibilityState === "visible") scheduleFlush(0);
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVis);
  // Probe: online event is unreliable — periodic attempt while pending.
  const interval = window.setInterval(() => {
    void (async () => {
      if ((await outboxPendingCount()) > 0) scheduleFlush(0);
    })();
  }, 15_000);
  scheduleFlush(500);
  return () => {
    started = false;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVis);
    window.clearInterval(interval);
    if (flushTimer) clearTimeout(flushTimer);
  };
}
