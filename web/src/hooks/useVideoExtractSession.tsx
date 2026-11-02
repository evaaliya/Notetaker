import { useCallback, useSyncExternalStore } from "react";
import {
  cancelVideoExtract,
  clearVideoExtractError,
  clearVideoExtractReady,
  getVideoExtractSnapshot,
  startVideoExtract,
  subscribeVideoExtract,
  type VideoExtractReady,
  type VideoExtractSnapshot,
} from "../lib/videoExtractSession";

export type { VideoExtractReady };

type Ctx = VideoExtractSnapshot & {
  start: (youtubeUrl: string, timezone?: string) => Promise<void>;
  cancel: () => Promise<void>;
  clearReady: () => void;
  clearError: () => void;
};

/** Job poll lives in a module store (D-106) — survives route changes and provider remounts. */
export function useVideoExtractSession(): Ctx {
  const snap = useSyncExternalStore(subscribeVideoExtract, getVideoExtractSnapshot, getVideoExtractSnapshot);
  const start = useCallback((url: string, timezone?: string) => startVideoExtract(url, timezone), []);
  const cancel = useCallback(() => cancelVideoExtract(), []);
  const clearReady = useCallback(() => clearVideoExtractReady(), []);
  const clearError = useCallback(() => clearVideoExtractError(), []);
  return { ...snap, start, cancel, clearReady, clearError };
}
