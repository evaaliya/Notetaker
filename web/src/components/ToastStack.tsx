export type ToastItem = {
  id: string;
  title: string;
  body: string;
};

type Props = {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onMuteSound?: () => void;
  /** Show mute while melody is audible or alarm is pending unlock. */
  showMute?: boolean;
  audioBlockedHint?: boolean;
};

export function ToastStack({
  toasts,
  onDismiss,
  onMuteSound,
  showMute = false,
  audioBlockedHint = false,
}: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" data-testid="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-testid="toast" data-toast-id={t.id}>
          <div>
            <strong>{t.title || "Напоминание"}</strong>
            {t.body ? <p className="small muted">{t.body}</p> : null}
            {audioBlockedHint ? (
              <p className="small muted" data-testid="audio-blocked-hint">
                Нажмите на страницу, чтобы включить звук
              </p>
            ) : null}
          </div>
          <div className="toast-actions">
            {showMute && onMuteSound ? (
              <button
                type="button"
                className="secondary"
                data-testid="mute-alarm"
                onClick={onMuteSound}
              >
                Выключить звук
              </button>
            ) : null}
            <button type="button" className="secondary" onClick={() => onDismiss(t.id)}>
              Закрыть
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
