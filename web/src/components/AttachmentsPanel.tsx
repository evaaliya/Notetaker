import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2, X } from "lucide-react";
import { ApiError, Attachment, api } from "../api";
import type { PendingFile } from "../lib/noteDraftIdb";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function isImageFile(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

type Props = {
  noteId: string | null;
  /** Compact mode for calendar side panel. */
  compact?: boolean;
  /**
   * Editor layout (D-092): icon-only paperclip, no dashed empty drop zone;
   * parent may bind body DnD via ingestRef.
   */
  chrome?: "panel" | "editor";
  /** Client queue before note has an id (autosave /notes/new). */
  pendingFiles?: PendingFile[];
  onAddPending?: (files: File[]) => void;
  onRemovePending?: (localId: string) => void;
  /** Parent drop zones call this to reuse upload/pending queue. */
  ingestRef?: MutableRefObject<((files: FileList | File[]) => void) | null>;
};

export function AttachmentsPanel({
  noteId,
  compact = false,
  chrome = "panel",
  pendingFiles = [],
  onAddPending,
  onRemovePending,
  ingestRef,
}: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const [pendingLightbox, setPendingLightbox] = useState<PendingFile | null>(null);
  const editorChrome = chrome === "editor";

  const list = useQuery({
    queryKey: ["attachments", noteId],
    queryFn: () => api.listAttachments(noteId!),
    enabled: Boolean(noteId),
  });

  const allowPending = !noteId && Boolean(onAddPending);

  async function uploadFiles(files: FileList | File[]) {
    if (!noteId) return;
    setError(null);
    const arr = Array.from(files);
    for (const file of arr) {
      setProgress(0);
      try {
        await api.uploadAttachment(noteId, file, setProgress);
        await qc.invalidateQueries({ queryKey: ["attachments", noteId] });
        await qc.invalidateQueries({ queryKey: ["note", noteId] });
        await qc.invalidateQueries({ queryKey: ["notes"] });
        await qc.invalidateQueries({ queryKey: ["calendar"] });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Не удалось загрузить файл";
        setError(msg);
        break;
      } finally {
        setProgress(null);
      }
    }
  }

  function ingest(files: FileList | File[] | null) {
    if (!files?.length) return;
    const arr = Array.from(files);
    if (noteId) {
      void uploadFiles(arr);
    } else if (onAddPending) {
      onAddPending(arr);
    }
  }

  useEffect(() => {
    if (!ingestRef) return;
    ingestRef.current = (files) => ingest(files);
    return () => {
      ingestRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ingest closes over noteId/handlers
  }, [ingestRef, noteId, onAddPending]);

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    ingest(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    ingest(e.dataTransfer.files);
  }

  async function remove(att: Attachment) {
    if (!noteId) return;
    setError(null);
    try {
      await api.deleteAttachment(noteId, att.id);
      await qc.invalidateQueries({ queryKey: ["attachments", noteId] });
      await qc.invalidateQueries({ queryKey: ["note", noteId] });
      await qc.invalidateQueries({ queryKey: ["notes"] });
      await qc.invalidateQueries({ queryKey: ["calendar"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить");
    }
  }

  const items = list.data ?? [];
  const images = items.filter((a) => IMAGE_TYPES.has(a.content_type));
  const docs = items.filter((a) => !IMAGE_TYPES.has(a.content_type));
  const pendingImages = pendingFiles.filter((p) => isImageFile(p.file));
  const pendingDocs = pendingFiles.filter((p) => !isImageFile(p.file));
  const empty =
    (!noteId || (!list.isLoading && items.length === 0)) && pendingFiles.length === 0;

  return (
    <section
      className={`note-attachments-slot${dragOver ? " is-dragover" : ""}${compact ? " compact" : ""}${editorChrome ? " editor-chrome" : ""}`}
      data-testid="note-attachments-slot"
      aria-label="Вложения"
      onDragOver={
        editorChrome
          ? undefined
          : (e) => {
              e.preventDefault();
              if (noteId || allowPending) setDragOver(true);
            }
      }
      onDragLeave={editorChrome ? undefined : () => setDragOver(false)}
      onDrop={editorChrome ? undefined : onDrop}
    >
      <div className="attachments-head">
        {!editorChrome && <div className="lab">Вложения</div>}
        <button
          type="button"
          className="secondary icon-btn"
          data-testid="attachment-add"
          aria-label="Прикрепить файл"
          title="Прикрепить файл"
          onClick={() => inputRef.current?.click()}
          disabled={!noteId && !allowPending}
        >
          <Paperclip size={18} strokeWidth={2} aria-hidden />
          {!compact && !editorChrome && <span>Файл</span>}
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          data-testid="attachment-file-input"
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.docx,image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          multiple
          onChange={onInputChange}
        />
      </div>

      {progress != null && (
        <div className="attachment-progress" data-testid="attachment-progress" role="status">
          Загрузка… {progress}%
          <div className="attachment-progress-bar">
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {error && (
        <p className="error" data-testid="attachment-error">
          {error}
        </p>
      )}

      {noteId && list.isLoading && <p className="muted small">Загрузка…</p>}

      {(pendingImages.length > 0 || images.length > 0) && (
        <ul className="attachment-thumbs" data-testid="attachment-thumbs">
          {pendingImages.map((p) => (
            <li key={p.localId} data-testid="attachment-pending">
              <button
                type="button"
                className="attachment-thumb"
                data-testid="attachment-thumb"
                aria-label={`Превью ${p.file.name}`}
                onClick={() => setPendingLightbox(p)}
              >
                <img src={p.previewUrl} alt={p.file.name} />
              </button>
              <div className="attachment-thumb-actions">
                <span className="muted small">Ожидает сохранения</span>
                <button
                  type="button"
                  className="linkish danger-text"
                  data-testid="attachment-delete-pending"
                  onClick={() => onRemovePending?.(p.localId)}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
          {noteId &&
            images.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="attachment-thumb"
                  data-testid="attachment-thumb"
                  aria-label={`Превью ${a.filename}`}
                  onClick={() => setLightbox(a)}
                >
                  <img src={api.attachmentUrl(noteId, a.id)} alt={a.filename} />
                </button>
                <div className="attachment-thumb-actions">
                  <a
                    className="small"
                    href={api.attachmentUrl(noteId, a.id)}
                    download={a.filename}
                  >
                    Скачать
                  </a>
                  <button
                    type="button"
                    className="linkish danger-text"
                    data-testid="attachment-delete"
                    onClick={() => void remove(a)}
                  >
                    Удалить
                  </button>
                </div>
              </li>
            ))}
        </ul>
      )}

      {(pendingDocs.length > 0 || docs.length > 0) && (
        <ul className="attachment-docs" data-testid="attachment-docs">
          {pendingDocs.map((p) => (
            <li key={p.localId} className="attachment-doc-row" data-testid="attachment-pending">
              <FileText size={20} aria-hidden strokeWidth={1.75} />
              <div className="attachment-doc-meta">
                <span className="attachment-doc-name">{p.file.name}</span>
                <span className="muted small">
                  {formatSize(p.file.size)} · ожидает сохранения
                </span>
              </div>
              <span />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Удалить ${p.file.name}`}
                data-testid="attachment-delete-pending"
                onClick={() => onRemovePending?.(p.localId)}
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </li>
          ))}
          {noteId &&
            docs.map((a) => (
              <li key={a.id} className="attachment-doc-row">
                <FileText size={20} aria-hidden strokeWidth={1.75} />
                <div className="attachment-doc-meta">
                  <span className="attachment-doc-name">{a.filename}</span>
                  <span className="muted small">{formatSize(a.size)}</span>
                </div>
                <a
                  className="secondary small"
                  href={api.attachmentUrl(noteId, a.id)}
                  download={a.filename}
                >
                  Скачать
                </a>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Удалить ${a.filename}`}
                  data-testid="attachment-delete"
                  onClick={() => void remove(a)}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            ))}
        </ul>
      )}

      {empty && !editorChrome && (
        <p className="muted small">
          {allowPending || noteId
            ? "Перетащите файл сюда или нажмите скрепку"
            : "Сохраните заметку, чтобы добавить файлы"}
        </p>
      )}
      {empty && editorChrome && !(allowPending || noteId) && (
        <p className="muted small">Сохраните заметку, чтобы добавить файлы</p>
      )}

      {lightbox && noteId && (
        <div
          className="attachment-lightbox"
          data-testid="attachment-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.filename}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="attachment-lightbox-close"
            aria-label="Закрыть"
            onClick={() => setLightbox(null)}
          >
            <X size={22} aria-hidden />
          </button>
          <img
            src={api.attachmentUrl(noteId, lightbox.id)}
            alt={lightbox.filename}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {pendingLightbox && (
        <div
          className="attachment-lightbox"
          data-testid="attachment-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={pendingLightbox.file.name}
          onClick={() => setPendingLightbox(null)}
        >
          <button
            type="button"
            className="attachment-lightbox-close"
            aria-label="Закрыть"
            onClick={() => setPendingLightbox(null)}
          >
            <X size={22} aria-hidden />
          </button>
          <img
            src={pendingLightbox.previewUrl}
            alt={pendingLightbox.file.name}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}

export function AttachmentClipIcon({ title = "Есть вложения" }: { title?: string }) {
  return (
    <span className="attachment-clip" title={title} data-testid="note-has-attachments" aria-label={title}>
      <Paperclip size={14} strokeWidth={2.25} aria-hidden />
    </span>
  );
}
