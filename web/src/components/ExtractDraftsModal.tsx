import { ExtractDraft } from "../api";

export type PendingDraft = ExtractDraft & { selected: boolean; key: string };

type Props = {
  open: boolean;
  pending: PendingDraft[];
  transcript?: string | null;
  busy?: boolean;
  onChange: (next: PendingDraft[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
  testId?: string;
};

export function ExtractDraftsModal({
  open,
  pending,
  transcript,
  busy,
  onChange,
  onCancel,
  onConfirm,
  testId = "extract-drafts-modal",
}: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" data-testid={testId}>
      <div className="modal-card modal-wide" role="dialog" aria-modal="true">
        <h2>Подтвердите черновики</h2>
        <p className="muted">
          Ничего не создаётся, пока вы не подтвердите. У заметок будет метка «создано ИИ».
        </p>
        {transcript ? (
          <details className="transcript-preview" data-testid="extract-transcript">
            <summary>Распознанный текст</summary>
            <pre>{transcript}</pre>
          </details>
        ) : null}
        <ul className="draft-list" data-testid="extract-draft-list">
          {pending.map((d) => (
            <li key={d.key}>
              <label className="draft-row">
                <input
                  type="checkbox"
                  checked={d.selected}
                  onChange={(e) =>
                    onChange(
                      pending.map((x) =>
                        x.key === d.key ? { ...x, selected: e.target.checked } : x,
                      ),
                    )
                  }
                />
                <span>
                  <strong>{d.title}</strong>
                  <span className="ai-badge">создано ИИ</span>
                  <span className="muted small"> · {d.kind}</span>
                  <div className="muted small">{d.body.slice(0, 160)}</div>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="capture-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="btn-accent"
            data-testid="extract-confirm-drafts"
            disabled={busy}
            onClick={onConfirm}
          >
            Создать выбранные
          </button>
        </div>
      </div>
    </div>
  );
}

export function draftsFromExtract(
  summary: ExtractDraft | null | undefined,
  drafts: ExtractDraft[],
): PendingDraft[] {
  const rows: PendingDraft[] = [];
  if (summary) {
    rows.push({ ...summary, selected: true, key: `summary-${summary.title}` });
  }
  drafts.forEach((d, i) => {
    rows.push({ ...d, selected: true, key: `d-${i}-${d.title}` });
  });
  return rows;
}
