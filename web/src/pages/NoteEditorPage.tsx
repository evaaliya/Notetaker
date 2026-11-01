import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarClock, Paperclip, Repeat, Tag as TagIcon } from "lucide-react";
import { ApiError, api, Note, Recurrence, Tag, User } from "../api";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { ConflictDialog } from "../components/ConflictDialog";
import { EditorMetaDisclosure } from "../components/EditorMetaDisclosure";
import { NotesRail } from "../components/NotesRail";
import { RecurrenceField } from "../components/RecurrenceField";
import { ReminderOffsetsField, REMINDER_OPTIONS } from "../components/ReminderOffsetsField";
import { SharePanel } from "../components/SharePanel";
import { TagMultiSelect } from "../components/TagMultiSelect";
import { TagPill } from "../components/TagPill";
import {
  formatInZone,
  formatSeriesRecurrenceHint,
  localInputToUtcIso,
  utcIsoToLocalInput,
} from "../format";
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
import { invalidateNoteCaches } from "../lib/queryInvalidation";

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
          invalidateNoteCaches(qc, { noteId: n.id });
          navigate(`/notes/${n.id}`, { replace: true });
        }}
        onPatched={(n) => {
          invalidateNoteCaches(qc, { noteId: n.id });
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
  const [metaOpen, setMetaOpen] = useState<{
    when: boolean;
    recurrence: boolean;
    reminders: boolean;
    tags: boolean;
  }>({
    when: false,
    recurrence: false,
    reminders: false,
    tags: false,
  });
  const [bodyDragOver, setBodyDragOver] = useState(false);
  const attachmentIngestRef = useRef<((files: FileList | File[]) => void) | null>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);

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
        invalidateNoteCaches(qc, { noteId });
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

  function setTagIdsDirty(next: string[]) {
    setTagIds(next);
    fieldsRef.current = { ...fieldsRef.current, tagIds: next };
    markDirty();
  }

  function openMeta(key: keyof typeof metaOpen, open: boolean) {
    setMetaOpen(
      open
        ? { when: false, recurrence: false, reminders: false, tags: false, [key]: true }
        : { when: false, recurrence: false, reminders: false, tags: false },
    );
  }

  const selectedTags = tags.filter((t) => tagIds.includes(t.id));
  const attachCount =
    pendingFiles.length + (note?.has_attachments || noteRef.current?.has_attachments ? 1 : 0);

  function onBodyDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setBodyDragOver(true);
  }

  function onBodyDragLeave(e: DragEvent) {
    e.preventDefault();
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    setBodyDragOver(false);
  }

  function onBodyDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBodyDragOver(false);
    const files = e.dataTransfer.files;
    if (files?.length) attachmentIngestRef.current?.(files);
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
          <div className="note-editor-bar-inner">
            <div className="note-editor-heading-wrap">
              {note?.ai_generated ? (
                <span className="ai-badge" data-testid="ai-generated-badge">
                  создано ИИ
                </span>
              ) : (
                <span className="note-editor-chrome-label muted small">
                  {note ? "Заметка" : "Новая заметка"}
                </span>
              )}
            </div>
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
          </div>
        </header>

        <div className="note-editor-body">
          <div
            className={`note-writing-surface${bodyDragOver ? " is-dragover" : ""}`}
            data-testid="note-body-dropzone"
            onDragEnter={onBodyDragOver}
            onDragOver={onBodyDragOver}
            onDragLeave={onBodyDragLeave}
            onDrop={onBodyDrop}
          >
            <label className="note-title-field">
              <span className="visually-hidden">Название</span>
              <input
                data-testid="note-title"
                className="note-title-input"
                value={title}
                placeholder="Название"
                onChange={(e) => {
                  const v = e.target.value;
                  setTitle(v);
                  fieldsRef.current = { ...fieldsRef.current, title: v };
                  markDirty();
                }}
              />
            </label>
            {selectedTags.length > 0 ? (
              <div className="note-selected-tags" data-testid="note-selected-tags">
                {selectedTags.map((t) => (
                  <TagPill key={t.id} name={t.name} color={t.color} />
                ))}
              </div>
            ) : null}
            <label className="note-body-field">
              <span className="visually-hidden">Текст</span>
              <textarea
                data-testid="note-body"
                className="note-body-textarea"
                value={body}
                placeholder="Текст"
                onChange={(e) => {
                  const v = e.target.value;
                  setBody(v);
                  fieldsRef.current = { ...fieldsRef.current, body: v };
                  markDirty();
                }}
                rows={12}
              />
            </label>
            {bodyDragOver ? (
              <div className="note-body-drop-hint" data-testid="note-body-drop-hint" aria-hidden>
                Отпустите, чтобы прикрепить
              </div>
            ) : null}
          </div>

          <div className="note-action-bar" data-testid="note-meta-bar" role="toolbar" aria-label="Параметры заметки">
            <EditorMetaDisclosure
              testId="meta-when"
              label="Дата"
              summary={startsLocal ? startsLocal.replace("T", " ") : ""}
              icon={<CalendarClock size={18} strokeWidth={2} />}
              open={metaOpen.when}
              onOpenChange={(o) => openMeta("when", o)}
            >
              <label className="editor-tool-field">
                Время
                <span className="muted small" data-testid="note-tz-hint">
                  {" "}
                  (пояс {user.timezone})
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
            </EditorMetaDisclosure>

            <EditorMetaDisclosure
              testId="meta-recurrence"
              label="Повтор"
              summary={
                recurrence
                  ? formatSeriesRecurrenceHint(recurrence.freq, recurrence.until)
                  : ""
              }
              icon={<Repeat size={18} strokeWidth={2} />}
              open={metaOpen.recurrence}
              onOpenChange={(o) => openMeta("recurrence", o)}
            >
              <RecurrenceField
                embedded
                value={recurrence}
                onChange={(v) => {
                  setRecurrence(v);
                  fieldsRef.current = { ...fieldsRef.current, recurrence: v };
                  markDirty();
                }}
                timeZone={user.timezone}
                lockedTz={note?.rec_tz}
              />
            </EditorMetaDisclosure>

            <EditorMetaDisclosure
              testId="meta-reminders"
              label="Напоминания"
              summary={
                reminderOffsets.length === 0
                  ? ""
                  : REMINDER_OPTIONS.filter((o) => reminderOffsets.includes(o.minutes))
                      .map((o) => o.label)
                      .join(", ")
              }
              icon={<Bell size={18} strokeWidth={2} />}
              open={metaOpen.reminders}
              onOpenChange={(o) => openMeta("reminders", o)}
            >
              <ReminderOffsetsField
                embedded
                value={reminderOffsets}
                onChange={(v) => {
                  setReminderOffsets(v);
                  fieldsRef.current = { ...fieldsRef.current, reminderOffsets: v };
                  markDirty();
                }}
                startsLocal={startsLocal}
                timeZone={user.timezone}
              />
            </EditorMetaDisclosure>

            <EditorMetaDisclosure
              testId="meta-tags"
              label="Теги"
              summary={
                tagIds.length === 0
                  ? ""
                  : selectedTags.map((t) => t.name).join(", ") || String(tagIds.length)
              }
              icon={<TagIcon size={18} strokeWidth={2} />}
              open={metaOpen.tags}
              onOpenChange={(o) => openMeta("tags", o)}
            >
              <TagMultiSelect tags={tags} value={tagIds} onChange={setTagIdsDirty} />
            </EditorMetaDisclosure>

            <div className="editor-tool editor-tool-attach">
              <button
                type="button"
                className="editor-tool-btn"
                data-testid="note-attach-btn"
                aria-label="Прикрепить файл"
                title="Прикрепить файл"
                onClick={() => attachFileInputRef.current?.click()}
              >
                <span className="editor-tool-icon" aria-hidden="true">
                  <Paperclip size={18} strokeWidth={2} />
                </span>
                <span className="editor-tool-label">Файл</span>
                {attachCount > 0 ? (
                  <span className="editor-tool-summary muted" data-testid="note-attach-count">
                    есть
                  </span>
                ) : null}
              </button>
              <input
                ref={attachFileInputRef}
                type="file"
                hidden
                data-testid="note-attach-file-input"
                accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.docx,image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                onChange={(e) => {
                  const files = e.target.files;
                  if (files?.length) attachmentIngestRef.current?.(files);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <AttachmentsPanel
            chrome="editor"
            noteId={note?.id ?? noteRef.current?.id ?? null}
            pendingFiles={pendingFiles}
            onAddPending={addPending}
            onRemovePending={removePending}
            ingestRef={attachmentIngestRef}
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
