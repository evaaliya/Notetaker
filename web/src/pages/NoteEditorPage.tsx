import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, Note, Recurrence, Tag, User } from "../api";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { ConflictDialog } from "../components/ConflictDialog";
import { NotesRail } from "../components/NotesRail";
import { RecurrenceField } from "../components/RecurrenceField";
import { ReminderOffsetsField } from "../components/ReminderOffsetsField";
import { SharePanel } from "../components/SharePanel";
import { formatInZone, localInputToUtcIso, utcIsoToLocalInput } from "../format";
import {
  NEW_DRAFT_KEY,
  PendingFile,
  clearDraft,
  draftRecordToFile,
  filesToDraftRecords,
  loadDraft,
  pendingFromDraftFiles,
  revokePendingPreviews,
  saveDraft,
} from "../lib/noteDraftIdb";

const AUTOSAVE_MS = 600;

type Props = { user: User };

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function NoteEditorPage({ user }: Props) {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.listTags });
  const noteQuery = useQuery({
    queryKey: ["note", id],
    queryFn: () => api.getNote(id!),
    enabled: !isNew,
  });

  if (!isNew && noteQuery.isLoading) {
    return (
      <div className="notes-workspace" data-testid="note-editor-page">
        <NotesRail timeZone={user.timezone} />
        <div className="note-editor-pane">
          <p className="muted">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (!isNew && (noteQuery.isError || !noteQuery.data)) {
    return (
      <div className="notes-workspace" data-testid="note-editor-page">
        <NotesRail timeZone={user.timezone} />
        <div className="note-editor-pane">
          <p className="error">Заметка не найдена</p>
          <button type="button" className="secondary" onClick={() => navigate("/list")}>
            К списку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="notes-workspace" data-testid="note-editor-page">
      <NotesRail timeZone={user.timezone} />
      <NoteEditorForm
        key={isNew ? "new" : noteQuery.data!.id}
        user={user}
        tags={tags.data ?? []}
        note={isNew ? null : noteQuery.data!}
        onCancel={() => navigate("/list")}
        onCreated={(n) => {
          qc.invalidateQueries({ queryKey: ["notes"] });
          qc.invalidateQueries({ queryKey: ["note", n.id] });
          qc.invalidateQueries({ queryKey: ["calendar"] });
          qc.invalidateQueries({ queryKey: ["upcoming"] });
          navigate(`/notes/${n.id}`, { replace: true });
        }}
        onPatched={(n) => {
          qc.invalidateQueries({ queryKey: ["notes"] });
          qc.invalidateQueries({ queryKey: ["note", n.id] });
          qc.invalidateQueries({ queryKey: ["calendar"] });
          qc.invalidateQueries({ queryKey: ["upcoming"] });
        }}
      />
    </div>
  );
}

function hasMeaningfulContent(
  title: string,
  body: string,
  pending: PendingFile[],
): boolean {
  return title.trim().length > 0 || body.trim().length > 0 || pending.length > 0;
}

function NoteEditorForm({
  user,
  tags,
  note,
  onCancel,
  onCreated,
  onPatched,
}: {
  user: User;
  tags: Tag[];
  note: Note | null;
  onCancel: () => void;
  onCreated: (n: Note) => void;
  onPatched: (n: Note) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [startsLocal, setStartsLocal] = useState(
    note
      ? utcIsoToLocalInput(note.starts_at, user.timezone)
      : utcIsoToLocalInput(new Date().toISOString(), user.timezone),
  );
  const [tagIds, setTagIds] = useState<string[]>(note?.tag_ids ?? []);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>(
    note?.reminder_offsets ?? [],
  );
  const [recurrence, setRecurrence] = useState<Recurrence | null>(() =>
    note?.rec_freq
      ? {
          freq: note.rec_freq as Recurrence["freq"],
          until: note.rec_until,
          tz: note.rec_tz || user.timezone,
        }
      : null,
  );
  const [version, setVersion] = useState(note?.version ?? 1);
  const [baseline, setBaseline] = useState(note);
  const [error, setError] = useState<string | null>(null);
  const [conflictNote, setConflictNote] = useState<Note | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [draftReady, setDraftReady] = useState(Boolean(note));
  const [dirty, setDirty] = useState(false);

  const noteRef = useRef(note);
  const versionRef = useRef(version);
  const createPromiseRef = useRef<Promise<Note> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(pendingFiles);
  const fieldsRef = useRef({
    title,
    body,
    startsLocal,
    tagIds,
    reminderOffsets,
    recurrence,
  });
  const uploadingRef = useRef(false);
  const skipNextDirtyRef = useRef(false);

  noteRef.current = note;
  versionRef.current = version;
  pendingRef.current = pendingFiles;
  fieldsRef.current = {
    title,
    body,
    startsLocal,
    tagIds,
    reminderOffsets,
    recurrence,
  };

  // Restore /notes/new draft from IndexedDB once.
  useEffect(() => {
    if (note) {
      setDraftReady(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const draft = await loadDraft(NEW_DRAFT_KEY);
        if (cancelled || !draft) {
          if (!cancelled) setDraftReady(true);
          return;
        }
        skipNextDirtyRef.current = true;
        const pending = pendingFromDraftFiles(draft.files);
        setTitle(draft.title);
        setBody(draft.body);
        setStartsLocal(draft.startsLocal);
        setTagIds(draft.tagIds);
        setReminderOffsets(draft.reminderOffsets);
        setRecurrence(draft.recurrence);
        setPendingFiles(pending);
        pendingRef.current = pending;
        fieldsRef.current = {
          title: draft.title,
          body: draft.body,
          startsLocal: draft.startsLocal,
          tagIds: draft.tagIds,
          reminderOffsets: draft.reminderOffsets,
          recurrence: draft.recurrence,
        };
        if (hasMeaningfulContent(draft.title, draft.body, pending)) {
          setDirty(true);
        }
      } catch {
        /* IndexedDB unavailable — continue without draft */
      } finally {
        if (!cancelled) setDraftReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [note]);

  const flushSaveRef = useRef<() => Promise<Note | null>>(async () => null);
  const persistIdbRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (!note) return;
    if (!baseline || note.id !== baseline.id) {
      skipNextDirtyRef.current = true;
      setTitle(note.title);
      setBody(note.body);
      setStartsLocal(utcIsoToLocalInput(note.starts_at, user.timezone));
      setTagIds([...note.tag_ids]);
      setReminderOffsets([...(note.reminder_offsets ?? [])]);
      setVersion(note.version);
      setBaseline(note);
      setRecurrence(
        note.rec_freq
          ? {
              freq: note.rec_freq as Recurrence["freq"],
              until: note.rec_until,
              tz: note.rec_tz || user.timezone,
            }
          : null,
      );
      setDirty(false);
    }
  }, [note, baseline, user.timezone]);

  const persistIdb = useCallback(async () => {
    if (noteRef.current) return; // after create, server is source of truth
    const f = fieldsRef.current;
    const pending = pendingRef.current;
    // Never clearDraft from here: empty React state on unmount must not wipe
    // an IndexedDB draft that was not loaded into this mount yet (D-057).
    if (!hasMeaningfulContent(f.title, f.body, pending)) {
      return;
    }
    await saveDraft({
      key: NEW_DRAFT_KEY,
      title: f.title,
      body: f.body,
      startsLocal: f.startsLocal,
      tagIds: f.tagIds,
      reminderOffsets: f.reminderOffsets,
      recurrence: f.recurrence,
      files: pending.map((p) => ({
        localId: p.localId,
        name: p.file.name,
        type: p.file.type,
        lastModified: p.file.lastModified,
        blob: p.file,
      })),
      updatedAt: Date.now(),
    });
  }, []);

  persistIdbRef.current = persistIdb;

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (idbTimerRef.current) clearTimeout(idbTimerRef.current);
      // Persist draft to IDB; server flush already done on visibility/Закрыть.
      // Avoid setState via flushSave after unmount (StrictMode / navigate).
      void persistIdbRef.current().catch(() => undefined);
      revokePendingPreviews(pendingRef.current);
    };
  }, []);

  const scheduleIdb = useCallback(() => {
    if (idbTimerRef.current) clearTimeout(idbTimerRef.current);
    idbTimerRef.current = setTimeout(() => {
      void persistIdb().catch(() => undefined);
    }, 200);
  }, [persistIdb]);

  const uploadPending = useCallback(
    async (noteId: string, files: PendingFile[]) => {
      if (!files.length || uploadingRef.current) return;
      uploadingRef.current = true;
      try {
        for (const p of files) {
          await api.uploadAttachment(noteId, p.file);
        }
        revokePendingPreviews(files);
        setPendingFiles([]);
        pendingRef.current = [];
        await qc.invalidateQueries({ queryKey: ["attachments", noteId] });
        await qc.invalidateQueries({ queryKey: ["note", noteId] });
        await qc.invalidateQueries({ queryKey: ["notes"] });
        await qc.invalidateQueries({ queryKey: ["calendar"] });
      } finally {
        uploadingRef.current = false;
      }
    },
    [qc],
  );

  const flushSave = useCallback(
    async (opts?: { immediateCreate?: boolean }): Promise<Note | null> => {
      const f = fieldsRef.current;
      const pending = pendingRef.current;
      const meaningful = hasMeaningfulContent(f.title, f.body, pending);
      if (!meaningful && !noteRef.current) {
        setDirty(false);
        return null;
      }

      setSaveStatus("saving");
      setError(null);
      try {
        const starts_at = localInputToUtcIso(f.startsLocal, user.timezone);
        let current = noteRef.current;

        if (!current) {
          if (!createPromiseRef.current) {
            createPromiseRef.current = api
              .createNote({
                title: f.title,
                body: f.body,
                starts_at,
                tag_ids: f.tagIds,
                reminder_offsets: f.reminderOffsets,
                ...(f.recurrence ? { recurrence: f.recurrence } : {}),
              })
              .then(async (saved) => {
                noteRef.current = saved;
                versionRef.current = saved.version;
                setVersion(saved.version);
                setBaseline(saved);
                const queued = pendingRef.current;
                if (queued.length) {
                  await uploadPending(saved.id, queued);
                }
                // Clear IDB after consumers are notified — avoids empty draft if
                // reload wins the race between clearDraft and navigate (D-057).
                onCreated(saved);
                await clearDraft(NEW_DRAFT_KEY).catch(() => undefined);
                return saved;
              })
              .finally(() => {
                createPromiseRef.current = null;
              });
          }
          current = await createPromiseRef.current;
        } else {
          const saved = await api.patchNote(current.id, {
            version: versionRef.current,
            title: f.title,
            body: f.body,
            starts_at,
            tag_ids: f.tagIds,
            reminder_offsets: f.reminderOffsets,
            recurrence: f.recurrence,
          });
          versionRef.current = saved.version;
          setVersion(saved.version);
          setBaseline(saved);
          noteRef.current = saved;
          onPatched(saved);
          current = saved;
        }

        // Race: files added while create was in flight
        if (pendingRef.current.length && current) {
          await uploadPending(current.id, pendingRef.current);
        }

        setDirty(false);
        setSaveStatus("saved");
        void opts;
        return current;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.note) {
          setConflictNote(err.note);
          setSaveStatus("error");
        } else {
          setError(err instanceof Error ? err.message : "Ошибка сохранения");
          setSaveStatus("error");
        }
        return null;
      }
    },
    [onCreated, onPatched, uploadPending, user.timezone],
  );

  flushSaveRef.current = () => flushSave({ immediateCreate: true });

  const scheduleSave = useCallback(
    (immediate = false) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (immediate) {
        void flushSave({ immediateCreate: true });
        return;
      }
      saveTimerRef.current = setTimeout(() => {
        void flushSave();
      }, AUTOSAVE_MS);
    },
    [flushSave],
  );

  function markDirty(nextImmediate = false) {
    if (skipNextDirtyRef.current) {
      skipNextDirtyRef.current = false;
      return;
    }
    setDirty(true);
    scheduleIdb();
    const f = fieldsRef.current;
    const pending = pendingRef.current;
    if (!noteRef.current && !hasMeaningfulContent(f.title, f.body, pending)) {
      return;
    }
    scheduleSave(nextImmediate);
  }

  // After restoring a non-empty draft, kick autosave (create).
  useEffect(() => {
    if (!draftReady || note) return;
    if (hasMeaningfulContent(title, body, pendingFiles)) {
      scheduleSave(pendingFiles.length > 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once when draftReady flips
  }, [draftReady]);

  // BrowserRouter has no useBlocker — rely on IDB + beforeunload + visibility flush (D-057).
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty && saveStatus !== "saving") return;
      void persistIdb();
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saveStatus, persistIdb]);

  // Visibility: flush when tab hidden
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "hidden" && dirty) {
        void persistIdb();
        void flushSave({ immediateCreate: true });
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [dirty, flushSave, persistIdb]);

  function toggleTag(id: string) {
    setTagIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      fieldsRef.current = { ...fieldsRef.current, tagIds: next };
      return next;
    });
    markDirty();
  }

  function addPending(files: File[]) {
    const recs = filesToDraftRecords(files);
    const added: PendingFile[] = recs.map((r) => ({
      localId: r.localId,
      file: draftRecordToFile(r),
      previewUrl: URL.createObjectURL(r.blob),
    }));
    const next = [...pendingRef.current, ...added];
    pendingRef.current = next;
    setPendingFiles(next);
    setDirty(true);
    scheduleIdb();
    // File alone must create the note immediately (req §15 / D-057).
    void flushSave({ immediateCreate: true });
  }

  function removePending(localId: string) {
    setPendingFiles((prev) => {
      const victim = prev.find((p) => p.localId === localId);
      if (victim) URL.revokeObjectURL(victim.previewUrl);
      const next = prev.filter((p) => p.localId !== localId);
      pendingRef.current = next;
      return next;
    });
    markDirty();
  }

  async function saveMine(server: Note) {
    setSaveStatus("saving");
    setError(null);
    try {
      const f = fieldsRef.current;
      const saved = await api.patchNote(noteRef.current!.id, {
        version: server.version,
        title: f.title,
        body: f.body,
        starts_at: localInputToUtcIso(f.startsLocal, user.timezone),
        tag_ids: f.tagIds,
        reminder_offsets: f.reminderOffsets,
        recurrence: f.recurrence,
      });
      setVersion(saved.version);
      versionRef.current = saved.version;
      setBaseline(saved);
      noteRef.current = saved;
      setConflictNote(null);
      setDirty(false);
      setSaveStatus("saved");
      onPatched(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
      setSaveStatus("error");
    }
  }

  function acceptServer(server: Note) {
    skipNextDirtyRef.current = true;
    setTitle(server.title);
    setBody(server.body);
    setStartsLocal(utcIsoToLocalInput(server.starts_at, user.timezone));
    setTagIds([...server.tag_ids]);
    setReminderOffsets([...(server.reminder_offsets ?? [])]);
    setVersion(server.version);
    versionRef.current = server.version;
    setBaseline(server);
    noteRef.current = server;
    setConflictNote(null);
    setDirty(false);
    setSaveStatus("saved");
    onPatched(server);
  }

  async function handleCancel() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!noteRef.current) {
      revokePendingPreviews(pendingRef.current);
      setPendingFiles([]);
      pendingRef.current = [];
      await clearDraft(NEW_DRAFT_KEY).catch(() => undefined);
      setDirty(false);
      onCancel();
      return;
    }
    if (dirty) {
      await flushSave({ immediateCreate: true });
    }
    onCancel();
  }

  const statusLabel =
    saveStatus === "saving"
      ? "Сохранение…"
      : saveStatus === "saved"
        ? "Сохранено"
        : saveStatus === "error"
          ? "Ошибка сохранения"
          : dirty
            ? "Не сохранено"
            : note
              ? "Сохранено"
              : "";

  if (!draftReady) {
    return (
      <div className="note-editor-pane">
        <p className="muted">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="note-editor-pane">
      <form
        className="note-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          void flushSave({ immediateCreate: true });
        }}
        data-testid="note-form"
      >
        <header className="note-editor-bar">
          <h1 className="note-editor-heading">{note ? "Заметка" : "Новая заметка"}</h1>
          <div className="note-editor-actions">
            <span
              className="muted small"
              data-testid="note-save-status"
              aria-live="polite"
            >
              {statusLabel}
            </span>
            <button type="button" className="secondary" onClick={() => void handleCancel()}>
              Закрыть
            </button>
          </div>
        </header>

        <div className="note-editor-body">
          <label>
            Название
            <input
              data-testid="note-title"
              value={title}
              onChange={(e) => {
                const v = e.target.value;
                setTitle(v);
                fieldsRef.current = { ...fieldsRef.current, title: v };
                markDirty();
              }}
            />
          </label>
          <label className="note-body-field">
            Текст
            <textarea
              data-testid="note-body"
              className="note-body-textarea"
              value={body}
              onChange={(e) => {
                const v = e.target.value;
                setBody(v);
                fieldsRef.current = { ...fieldsRef.current, body: v };
                markDirty();
              }}
              rows={12}
            />
          </label>
          <label>
            Время
            <span className="muted small" data-testid="note-tz-hint">
              {" "}
              (ввод в поясе {user.timezone})
            </span>
            <input
              type="datetime-local"
              data-testid="note-starts"
              value={startsLocal}
              onChange={(e) => {
                const v = e.target.value;
                setStartsLocal(v);
                fieldsRef.current = { ...fieldsRef.current, startsLocal: v };
                markDirty();
              }}
              required
            />
          </label>
          <RecurrenceField
            value={recurrence}
            onChange={(v) => {
              setRecurrence(v);
              fieldsRef.current = { ...fieldsRef.current, recurrence: v };
              markDirty();
            }}
            timeZone={user.timezone}
            lockedTz={note?.rec_tz}
          />
          <ReminderOffsetsField
            value={reminderOffsets}
            onChange={(v) => {
              setReminderOffsets(v);
              fieldsRef.current = { ...fieldsRef.current, reminderOffsets: v };
              markDirty();
            }}
            startsLocal={startsLocal}
            timeZone={user.timezone}
          />
          <fieldset className="tag-pick">
            <legend>Теги</legend>
            {tags.map((t) => (
              <label key={t.id} className="inline">
                <input
                  type="checkbox"
                  checked={tagIds.includes(t.id)}
                  onChange={() => toggleTag(t.id)}
                />
                <span className="tag-swatch tiny" style={{ background: t.color }} />
                {t.name}
              </label>
            ))}
          </fieldset>

          <AttachmentsPanel
            noteId={note?.id ?? noteRef.current?.id ?? null}
            pendingFiles={pendingFiles}
            onAddPending={addPending}
            onRemovePending={removePending}
          />

          {(note || noteRef.current) && (
            <SharePanel note={(note || noteRef.current)!} />
          )}

          {error && <p className="error">{error}</p>}
        </div>
      </form>
      {conflictNote && (
        <ConflictDialog
          draft={{ title, body, startsLocal }}
          server={conflictNote}
          timeZone={user.timezone}
          formatStarts={(iso) => utcIsoToLocalInput(iso, user.timezone)}
          formatUpdatedAt={(iso) => formatInZone(iso, user.timezone)}
          onMine={() => void saveMine(conflictNote)}
          onTheirs={() => acceptServer(conflictNote)}
          onClose={() => setConflictNote(null)}
        />
      )}
    </div>
  );
}
