"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Avatar } from "./shared";

/** Never ask twice within this long, however often the tab gains focus. */
const MIN_GAP_MS = 5000;

/**
 * Keeps an avatar list as fresh as Anam's own account. A face deleted (or added) in Anam's lab shows up in /api/avatars
 * only after the backend has read Anam's catalogue again; `?refresh=true` makes it do that now and wait for it (a few
 * seconds at most), so this asks once the page has its first list on screen and again whenever the tab comes back into
 * focus -- the moment after someone has been to Anam's lab. The first list is not held up by it: the page shows what the
 * database has at once and `onAvatars` swaps in the refreshed one. A failed or slow refresh changes nothing.
 */
export function useAvatarSync(enabled: boolean, onAvatars: (list: Avatar[]) => void) {
  const latest = useRef(onAvatars);
  const inFlight = useRef(false);
  const lastStarted = useRef(0);
  useEffect(() => {
    latest.current = onAvatars;
  });

  const sync = useCallback(async () => {
    if (inFlight.current || Date.now() - lastStarted.current < MIN_GAP_MS) return;
    inFlight.current = true;
    lastStarted.current = Date.now();
    try {
      const res = await fetch("/api/avatars?refresh=true", { cache: "no-store" });
      if (res.ok) latest.current((await res.json()) as Avatar[]);
    } catch {
      // keep the list on screen
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void sync();
    const onFocus = () => void sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, sync]);

  return sync;
}
