export type ToastItem = {
  id: string;
  title: string;
  body: string;
};

type Props = {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
};

export function ToastStack({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" data-testid="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-testid="toast" data-toast-id={t.id}>
          <div>
            <strong>{t.title || "Напоминание"}</strong>
            {t.body ? <p className="small muted">{t.body}</p> : null}
          </div>
          <button type="button" className="secondary" onClick={() => onDismiss(t.id)}>
            Закрыть
          </button>
        </div>
      ))}
    </div>
  );
}
