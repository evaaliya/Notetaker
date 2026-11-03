import { useEffect, useState } from "react";
import { outboxPendingCount, subscribeOutbox } from "../lib/mutationOutbox";

const MESSAGE =
  "Нет сети. Черновик сохранён на устройстве и отправится, когда связь вернётся";

/** Fixed overlay — does not shift layout (M22). */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const syncNet = () => setOffline(!navigator.onLine);
    window.addEventListener("online", syncNet);
    window.addEventListener("offline", syncNet);
    const refresh = () => {
      void outboxPendingCount().then(setQueued).catch(() => setQueued(0));
    };
    refresh();
    const unsub = subscribeOutbox(refresh);
    return () => {
      window.removeEventListener("online", syncNet);
      window.removeEventListener("offline", syncNet);
      unsub();
    };
  }, []);

  if (!offline && queued === 0) return null;

  return (
    <div
      className="offline-banner"
      role="status"
      data-testid="offline-banner"
      aria-live="polite"
    >
      {MESSAGE}
    </div>
  );
}
