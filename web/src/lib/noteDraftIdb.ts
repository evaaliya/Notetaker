/** IndexedDB draft for /notes/new (and dirty edits) — survives reload (D-057). */

const DB_NAME = "notetaker-drafts";
const DB_VERSION = 1;
const STORE = "drafts";

export const NEW_DRAFT_KEY = "new";

export type DraftFileRecord = {
  localId: string;
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
};

export type NoteDraftRecord = {
  key: string;
  title: string;
  body: string;
  startsLocal: string;
  tagIds: string[];
  reminderOffsets: number[];
  recurrence: {
    freq: "daily" | "weekly" | "monthly";
    until?: string | null;
    tz: string;
  } | null;
  files: DraftFileRecord[];
  updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

export async function loadDraft(key: string): Promise<NoteDraftRecord | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await idbReq(tx.objectStore(STORE).get(key));
    return (row as NoteDraftRecord | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function saveDraft(record: NoteDraftRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...record, updatedAt: Date.now() });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
    });
  } finally {
    db.close();
  }
}

export async function clearDraft(key: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
    });
  } finally {
    db.close();
  }
}

export function filesToDraftRecords(files: File[]): DraftFileRecord[] {
  return files.map((f) => ({
    localId: crypto.randomUUID(),
    name: f.name,
    type: f.type,
    lastModified: f.lastModified,
    blob: f,
  }));
}

export function draftRecordToFile(rec: DraftFileRecord): File {
  return new File([rec.blob], rec.name, {
    type: rec.type || undefined,
    lastModified: rec.lastModified || Date.now(),
  });
}

export type PendingFile = {
  localId: string;
  file: File;
  previewUrl: string;
};

export function pendingFromDraftFiles(files: DraftFileRecord[]): PendingFile[] {
  return files.map((f) => {
    const file = draftRecordToFile(f);
    return {
      localId: f.localId,
      file,
      previewUrl: URL.createObjectURL(file),
    };
  });
}

export function revokePendingPreviews(pending: PendingFile[]): void {
  for (const p of pending) {
    URL.revokeObjectURL(p.previewUrl);
  }
}
