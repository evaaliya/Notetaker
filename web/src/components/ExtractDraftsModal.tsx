import { ExtractDraft } from "../api";

export type PendingDraft = ExtractDraft & { selected: boolean; key: string };

export type SummaryLang = "en" | "ru";

type Props = {
  open: boolean;
  pending: PendingDraft[];
  transcript?: string | null;
  busy?: boolean;
  onChange: (next: PendingDraft[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
  testId?: string;
  /** When both EN summary and RU twin exist — show language radios. */
  summaryLang?: SummaryLang;
  onSummaryLangChange?: (lang: SummaryLang) => void;
  bilingual?: boolean;
  /** Video path: optional «Показать в календаре» (default off). Call modal omits this. */
  showInCalendar?: boolean;
  onShowInCalendarChange?: (value: boolean) => void;
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
  summaryLang,
  onSummaryLangChange,
  bilingual,
  showInCalendar,
  onShowInCalendarChange,
}: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" data-testid={testId}>
      <div className="modal-card modal-wide" role="dialog" aria-modal="true">
        <h2>Подтвердите черновики</h2>
        <p className="muted">
          Ничего не создаётся, пока вы не подтвердите. У заметок будет метка «создано ИИ».
          Конспект — основная заметка; задачи/решения создаются отдельно, только если отмечены.
        </p>
        {bilingual && onSummaryLangChange && summaryLang ? (
          <fieldset className="extract-lang" data-testid="extract-summary-lang">
            <legend className="lab">Язык конспекта</legend>
            <p className="muted small">
              Источник на английском — можно сохранить оригинал или перевод. Перевод может чуть
              исказить формулировки.
            </p>
            <div className="capture-actions">
              <label className="extract-lang-option">
                <input
                  type="radio"
                  name="summary-lang"
                  value="en"
                  checked={summaryLang === "en"}
                  onChange={() => onSummaryLangChange("en")}
                />
                English (оригинал)
              </label>
              <label className="extract-lang-option">
                <input
                  type="radio"
                  name="summary-lang"
                  value="ru"
                  checked={summaryLang === "ru"}
                  onChange={() => onSummaryLangChange("ru")}
                />
                Русский (перевод)
              </label>
            </div>
          </fieldset>
        ) : null}
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
                  <span className="muted small"> · {kindLabel(d.kind)}</span>
                  <div className="muted small">{d.body.slice(0, 160)}</div>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {onShowInCalendarChange != null && showInCalendar != null ? (
          <label className="draft-row" data-testid="extract-show-in-calendar">
            <input
              type="checkbox"
              checked={showInCalendar}
              onChange={(e) => onShowInCalendarChange(e.target.checked)}
            />
            <span>Показать в календаре</span>
          </label>
        ) : null}
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

function kindLabel(kind: ExtractDraft["kind"] | string): string {
  if (kind === "summary") return "конспект";
  if (kind === "decision") return "решение";
  if (kind === "task") return "задача";
  return String(kind);
}

/** @param selectKinds — if set, only these kinds are checked by default (video: summary only). */
export function draftsFromExtract(
  summary: ExtractDraft | null | undefined,
  drafts: ExtractDraft[],
  opts?: { selectKinds?: Array<ExtractDraft["kind"]> },
): PendingDraft[] {
  const allow = opts?.selectKinds ? new Set(opts.selectKinds) : null;
  const selectedFor = (kind: ExtractDraft["kind"]) => (allow ? allow.has(kind) : true);
  const rows: PendingDraft[] = [];
  if (summary) {
    rows.push({
      ...summary,
      kind: "summary",
      selected: selectedFor("summary"),
      key: "summary-main",
    });
  }
  drafts.forEach((d, i) => {
    const kind = d.kind || "task";
    rows.push({
      ...d,
      kind,
      selected: selectedFor(kind),
      key: `d-${i}-${d.title}`,
    });
  });
  return rows;
}

/** Swap the summary row body/title when user picks EN/RU; keep checkbox state. */
export function applySummaryLang(
  pending: PendingDraft[],
  summary: ExtractDraft,
): PendingDraft[] {
  return pending.map((row) =>
    row.kind === "summary" && row.key === "summary-main"
      ? {
          ...row,
          title: summary.title,
          body: summary.body,
          starts_at: summary.starts_at,
          reminder_offsets: summary.reminder_offsets,
          tag_names: summary.tag_names,
        }
      : row,
  );
}
