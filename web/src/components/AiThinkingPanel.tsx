import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export type AiThinkingStep = {
  id: string;
  label: string;
};

type Props = {
  active: boolean;
  steps: AiThinkingStep[];
  /** ms between advancing to the next step while waiting on the server */
  stepMs?: number;
  /** When set, drives the current step from the server job (M14). */
  currentStepId?: string | null;
  title?: string;
  testId?: string;
};

/** Staged “thinking” UI: simulated timer, or real job step via currentStepId. */
export function AiThinkingPanel({
  active,
  steps,
  stepMs = 1400,
  currentStepId = null,
  title = "ИИ думает",
  testId = "ai-thinking",
}: Props) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      return;
    }
    if (currentStepId) {
      const idx = steps.findIndex((s) => s.id === currentStepId);
      setStepIndex(idx >= 0 ? idx : 0);
      return;
    }
    setStepIndex(0);
    if (steps.length <= 1) return;
    const id = window.setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, stepMs);
    return () => window.clearInterval(id);
  }, [active, steps, stepMs, currentStepId]);

  if (!active || steps.length === 0) return null;

  return (
    <div
      className="ai-thinking"
      data-testid={testId}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="ai-thinking-head">
        <Sparkles className="ai-thinking-icon" aria-hidden size={18} strokeWidth={2} />
        <strong>{title}</strong>
        <span className="ai-thinking-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="ai-thinking-bar" aria-hidden>
        <span
          className="ai-thinking-bar-fill"
          style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
        />
      </div>
      <ol className="ai-thinking-steps">
        {steps.map((s, i) => {
          const state = i < stepIndex ? "done" : i === stepIndex ? "current" : "pending";
          return (
            <li key={s.id} className={`ai-thinking-step is-${state}`} data-state={state}>
              <span className="ai-thinking-mark" aria-hidden>
                {state === "done" ? "✓" : state === "current" ? "●" : "○"}
              </span>
              <span>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export const VIDEO_EXTRACT_STEPS: AiThinkingStep[] = [
  { id: "queued", label: "В очереди…" },
  { id: "captions", label: "Тяну субтитры YouTube…" },
  { id: "extract", label: "Модель собирает конспект…" },
  { id: "done", label: "Готово…" },
];

export const CALL_EXTRACT_STEPS: AiThinkingStep[] = [
  { id: "read", label: "Читаю транскрипт…" },
  { id: "thesis", label: "Выделяю главную мысль…" },
  { id: "tasks", label: "Ищу задачи и решения…" },
  { id: "drafts", label: "Собираю черновики…" },
];
