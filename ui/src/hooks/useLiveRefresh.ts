import { useEffect } from "react";

// Matches how often the backend flushes usage during a live call.
const LIVE_REFRESH_MS = 15_000;

/** Calls `refresh` on a timer and on returning to the tab, but never while hidden. */
export function useLiveRefresh(refresh: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const refreshIfVisible = () => {
      if (!document.hidden) refresh();
    };
    const intervalId = window.setInterval(refreshIfVisible, LIVE_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refresh, enabled]);
}
