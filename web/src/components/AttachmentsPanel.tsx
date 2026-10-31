import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2, X } from "lucide-react";
import { ApiError, Attachment, api } from "../api";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

type Props = {
  noteId: string | null;
  /** Compact mode for calendar side panel. */
  compact?: boolean;
};

export function AttachmentsPanel({ noteId, compact = false }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);

  const list = useQuery({
    queryKey: ["attachments", noteId],
    queryFn: () => api.listAttachments(noteId!),
    enabled: Boolean(noteId),
  });

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
        const msg =
          e instanceof ApiError
            ? e.message
            : "Не удалось загрузить файл";
        setError(msg);
        break;
      } finally {
        setProgress(null);
      }
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) void uploadFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
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

  if (!noteId) {
    return (
      <section
        className="note-attachments-slot"
        data-testid="note-attachments-slot"
        aria-label="Вложения"
      >
        <div className="lab">Вложения</div>
        <p className="muted small">Сохраните заметку, чтобы добавить файлы</p>
      </section>
    );
  }

  const items = list.data ?? [];
  const images = items.filter((a) => IMAGE_TYPES.has(a.content_type));
  const docs = items.filter((a) => !IMAGE_TYPES.has(a.content_type));

  return (
    <section
      className={`note-attachments-slot${dragOver ? " is-dragover" : ""}${compact ? " compact" : ""}`}
      data-testid="note-attachments-slot"
      aria-label="Вложения"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="attachments-head">
        <div className="lab">Вложения</div>
        <button
          type="button"
          className="secondary icon-btn"
          data-testid="attachment-add"
          aria-label="Прикрепить файл"
          title="Прикрепить файл"
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip size={18} strokeWidth={2} aria-hidden />
          {!compact && <span>Файл</span>}
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

      {list.isLoading && <p className="muted small">Загрузка…</p>}

      {images.length > 0 && (
        <ul className="attachment-thumbs" data-testid="attachment-thumbs">
          {images.map((a) => (
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

      {docs.length > 0 && (
        <ul className="attachment-docs" data-testid="attachment-docs">
          {docs.map((a) => (
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

      {!list.isLoading && items.length === 0 && (
        <p className="muted small">Перетащите файл сюда или нажмите скрепку</p>
      )}

      {lightbox && (
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
