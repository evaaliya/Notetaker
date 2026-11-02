import { FormEvent, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { Bell, CalendarClock, Paperclip, Tag as TagIcon, X } from "lucide-react";
import { ApiError, EditScope, api, Note, Tag, User } from "../api";
import {
  formatSeriesRecurrenceHint,
  localInputToUtcIso,
  utcIsoToLocalInput,
} from "../format";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { ConflictDialog } from "./ConflictDialog";
import { EditScopeDialog } from "./EditScopeDialog";
import { EditorMetaDisclosure } from "./EditorMetaDisclosure";
import { ReminderOffsetsField, REMINDER_OPTIONS, offsetsEqual } from "./ReminderOffsetsField";
import { SharePanel } from "./SharePanel";
import { TagMultiSelect } from "./TagMultiSelect";
import { TagPill } from "./TagPill";

type Props = {
  user: User;
  tags: Tag[];
  note: Note;
  /** When editing a series occurrence from calendar/upcoming. */
  occurrenceOriginalStart?: string | null;
  /** Mobile calendar: full-screen sheet instead of sticky aside. */
  presentation?: "aside" | "sheet";
  onClose: () => void;
  onSaved: (note: Note) => void;
  /** Move note / series to trash (calendar mobile — no drag zone). */
  onTrash?: () => void;
};

type MetaKey = "when" | "reminders" | "tags";

function formFromNote(note: Note, timeZone: string) {
  return {
    title: note.title,
    body: note.body,
    startsLocal: utcIsoToLocalInput(note.starts_at, timeZone),
    tagIds: [...note.tag_ids],
    reminderOffsets: [...(note.reminder_offsets ?? [])],
    version: note.version,
  };
}

export function NoteSidePanel({
  user,
  tags,
  note,
  occurrenceOriginalStart = null,
  presentation = "aside",
  onClose,
  onSaved,
  onTrash,
}: Props) {
  const isSeriesOcc = Boolean(note.rec_freq && occurrenceOriginalStart);
  const initial = formFromNote(note, user.timezone);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [startsLocal, setStartsLocal] = useState(initial.startsLocal);
  const [tagIds, setTagIds] = useState(initial.tagIds);
  const [reminderOffsets, setReminderOffsets] = useState(initial.reminderOffsets);
  const [version, setVersion] = useState(initial.version);
  const [baseline, setBaseline] = useState(note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remoteBanner, setRemoteBanner] = useState(false);
  const [conflictNote, setConflictNote] = useState<Note | null>(null);
  const [pendingScope, setPendingScope] = useState<"save" | "delete" | null>(null);
  const [metaOpen, setMetaOpen] = useState<Record<MetaKey, boolean>>({
    when: false,
    reminders: false,
    tags: false,
  });
  const [bodyDragOver, setBodyDragOver] = useState(false);
  const [hasAttachments, setHasAttachments] = useState(Boolean(note.has_attachments));
  const attachmentIngestRef = useRef<((files: FileList | File[]) => void) | null>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);

  const dirty = useMemo(() => {
    const starts = localInputToUtcIso(startsLocal, user.timezone);
    const tagsSame =
      tagIds.length === baseline.tag_ids.length &&
      tagIds.every((id) => baseline.tag_ids.includes(id));
    return (
      title !== baseline.title ||
      body !== baseline.body ||
      starts !== baseline.starts_at ||
      !tagsSame ||
      !offsetsEqual(reminderOffsets, baseline.reminder_offsets ?? [])
    );
  }, [title, body, startsLocal, tagIds, reminderOffsets, baseline, user.timezone]);

  useEffect(() => {
    // Same series note.id across occurrences — also reset when effective starts_at changes.
    if (note.id !== baseline.id || note.starts_at !== baseline.starts_at) {
      const f = formFromNote(note, user.timezone);
      setTitle(f.title);
      setBody(f.body);
      setStartsLocal(f.startsLocal);
      setTagIds(f.tagIds);
      setReminderOffsets(f.reminderOffsets);
      setVersion(f.version);
      setBaseline(note);
      setHasAttachments(Boolean(note.has_attachments));
      setRemoteBanner(false);
      setConflictNote(null);
      setError(null);
      setPendingScope(null);
      return;
    }
    if (note.version === baseline.version) return;
    if (!dirty) {
      const f = formFromNote(note, user.timezone);
      setTitle(f.title);
      setBody(f.body);
      setStartsLocal(f.startsLocal);
      setTagIds(f.tagIds);
      setReminderOffsets(f.reminderOffsets);
      setVersion(f.version);
      setBaseline(note);
      setHasAttachments(Boolean(note.has_attachments));
      setRemoteBanner(false);
    } else {
      setRemoteBanner(true);
    }
  }, [note, baseline.id, baseline.starts_at, baseline.version, dirty, user.timezone]);

  function openMeta(key: MetaKey, open: boolean) {
    setMetaOpen(
      open
        ? { when: false, reminders: false, tags: false, [key]: true }
        : { when: false, reminders: false, tags: false },
    );
  }

  function tagsDirtyAgainst(base: Note) {
    return !(
      tagIds.length === base.tag_ids.length && tagIds.every((id) => base.tag_ids.includes(id))
    );
  }

  async function saveWithScope(scope: EditScope, v: number) {
    setBusy(true);
    setError(null);
    setPendingScope(null);
    try {
      const fields: Record<string, unknown> = {
        version: v,
        title,
        body,
        starts_at: localInputToUtcIso(startsLocal, user.timezone),
      };
      if (!isSeriesOcc) {
        fields.tag_ids = tagIds;
        fields.reminder_offsets = reminderOffsets;
      } else if (scope === "following" || scope === "all") {
        fields.tag_ids = tagIds;
      }
      const opts =
        scope === "all" || !occurrenceOriginalStart
          ? { scope: "all" as const }
          : { scope, occurrence_start: occurrenceOriginalStart };
      let updated = await api.patchNote(note.id, fields, opts);
      // scope=this cannot carry tag_ids; apply series tags on the master separately.
      if (isSeriesOcc && scope === "this" && tagsDirtyAgainst(baseline)) {
        updated = await api.patchNote(
          note.id,
          { version: updated.version, tag_ids: tagIds },
          { scope: "all" },
        );
      }
      setVersion(updated.version);
      setBaseline(updated);
      setTagIds([...(updated.tag_ids ?? [])]);
      setReminderOffsets([...(updated.reminder_offsets ?? [])]);
      setHasAttachments(Boolean(updated.has_attachments));
      setConflictNote(null);
      setRemoteBanner(false);
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.note) {
        setConflictNote(err.note);
      } else {
        setError(err instanceof Error ? err.message : "Ошибка");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isSeriesOcc) {
      setPendingScope("save");
      return;
    }
    await saveWithScope("all", version);
  }

  async function deleteOccurrence() {
    if (!occurrenceOriginalStart) return;
    setBusy(true);
    setError(null);
    setPendingScope(null);
    try {
      const updated = await api.deleteNote(note.id, {
        scope: "this",
        occurrence_start: occurrenceOriginalStart,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function acceptServer(server: Note) {
    const f = formFromNote(server, user.timezone);
    setTitle(f.title);
    setBody(f.body);
    setStartsLocal(f.startsLocal);
    setTagIds(f.tagIds);
    setReminderOffsets(f.reminderOffsets);
    setVersion(f.version);
    setBaseline(server);
    setHasAttachments(Boolean(server.has_attachments));
    setConflictNote(null);
    setRemoteBanner(false);
    onSaved(server);
  }

  function onBodyDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setBodyDragOver(true);
  }

  function onBodyDragLeave(e: DragEvent) {
    e.preventDefault();
    if (e.currentTarget === e.target) setBodyDragOver(false);
  }

  function onBodyDrop(e: DragEvent) {
    e.preventDefault();
    setBodyDragOver(false);
    const files = e.dataTransfer.files;
    if (files?.length) attachmentIngestRef.current?.(files);
  }

  const selectedTags = tags.filter((t) => tagIds.includes(t.id));

  const panel = (
    <aside
      className={`side-panel card side-panel-editor${presentation === "sheet" ? " side-panel-sheet" : ""}`}
      data-testid="note-side-panel"
      role={presentation === "sheet" ? "dialog" : undefined}
      aria-modal={presentation === "sheet" ? true : undefined}
    >
      <form className="note-editor-form side-panel-form" onSubmit={submit}>
        <header className="note-editor-bar side-panel-bar">
          <div className="note-editor-bar-inner">
            <div className="note-editor-heading-wrap">
              <span className="note-editor-chrome-label muted small">
                {isSeriesOcc ? "Вхождение" : "Заметка"}
              </span>
              {isSeriesOcc && (
                <p className="muted small" data-testid="series-occ-hint">
                  {formatSeriesRecurrenceHint(note.rec_freq, note.rec_until)}
                </p>
              )}
            </div>
            <button
              type="button"
              className="side-panel-close"
              onClick={onClose}
              aria-label="Закрыть"
              data-testid="note-panel-close"
            >
              <X size={20} aria-hidden="true" strokeWidth={2} />
            </button>
          </div>
        </header>

        {remoteBanner && (
          <p className="banner" data-testid="remote-edit-banner">
            Заметка изменена на другом устройстве. При сохранении возможен конфликт.
          </p>
        )}

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
                onChange={(e) => setTitle(e.target.value)}
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
                onChange={(e) => setBody(e.target.value)}
                rows={8}
              />
            </label>
            {bodyDragOver ? (
              <div className="note-body-drop-hint" aria-hidden>
                Отпустите, чтобы прикрепить
              </div>
            ) : null}
          </div>

          <div
            className="note-action-bar"
            data-testid="note-meta-bar"
            role="toolbar"
            aria-label="Параметры заметки"
          >
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
                  onChange={(e) => setStartsLocal(e.target.value)}
                  required
                />
              </label>
            </EditorMetaDisclosure>

            {!isSeriesOcc && (
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
                  onChange={setReminderOffsets}
                  startsLocal={startsLocal}
                  timeZone={user.timezone}
                />
              </EditorMetaDisclosure>
            )}

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
              {isSeriesOcc && (
                <p className="muted small" data-testid="series-tags-hint">
                  Теги общие для серии
                </p>
              )}
              <TagMultiSelect tags={tags} value={tagIds} onChange={setTagIds} />
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
                {hasAttachments ? (
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
                  if (files?.length) {
                    attachmentIngestRef.current?.(files);
                    setHasAttachments(true);
                  }
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <AttachmentsPanel
            chrome="editor"
            noteId={note.id}
            ingestRef={attachmentIngestRef}
          />

          <SharePanel note={{ ...note, role: note.role ?? "owner" }} />

          {error && <p className="error">{error}</p>}

          <div className="side-panel-footer">
            <button type="submit" disabled={busy} data-testid="note-save">
              Сохранить
            </button>
            {onTrash && note.role !== "editor" && !isSeriesOcc && (
              <button
                type="button"
                className="secondary"
                data-testid="note-panel-trash"
                disabled={busy}
                onClick={() => onTrash()}
              >
                В корзину
              </button>
            )}
            {isSeriesOcc && note.role !== "editor" && (
              <button
                type="button"
                className="link"
                data-testid="delete-occurrence"
                disabled={busy}
                onClick={() => setPendingScope("delete")}
              >
                Удалить это вхождение
              </button>
            )}
            {onTrash && isSeriesOcc && note.role !== "editor" && (
              <button
                type="button"
                className="link"
                data-testid="note-panel-trash-series"
                disabled={busy}
                onClick={() => onTrash()}
              >
                В корзину…
              </button>
            )}
          </div>
        </div>
      </form>
      {pendingScope === "save" && (
        <EditScopeDialog
          onChoose={(scope) => saveWithScope(scope, version)}
          onClose={() => setPendingScope(null)}
        />
      )}
      {pendingScope === "delete" &&
        createPortal(
          <div className="modal-backdrop" data-testid="delete-occ-confirm" role="dialog">
            <div className="modal card">
              <h3>Удалить вхождение?</h3>
              <p className="muted small">Остальные вхождения серии останутся.</p>
              <div className="form-grid">
                <button type="button" onClick={() => void deleteOccurrence()}>
                  Удалить только это
                </button>
                <button type="button" className="secondary" onClick={() => setPendingScope(null)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {conflictNote && (
        <ConflictDialog
          draft={{ title, body, startsLocal }}
          server={conflictNote}
          timeZone={user.timezone}
          formatStarts={(iso) => utcIsoToLocalInput(iso, user.timezone)}
          onMine={() => saveWithScope(isSeriesOcc ? "this" : "all", conflictNote.version)}
          onTheirs={() => acceptServer(conflictNote)}
          onClose={() => setConflictNote(null)}
        />
      )}
    </aside>
  );

  if (presentation === "sheet") {
    return createPortal(
      <div
        className="side-panel-sheet-backdrop"
        data-testid="note-panel-sheet-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {panel}
      </div>,
      document.body,
    );
  }

  return panel;
}
