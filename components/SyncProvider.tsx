"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sync } from "@/lib/store";

/**
 * Loads server state before the app renders, so every page reads the same data
 * regardless of which device you're on. Falls through quickly if the database
 * isn't configured or is slow — the app must never be blocked by sync.
 *
 * Pages copy store data into React state when they mount. So when data from
 * another device lands after that (a slow first sync, or coming back to the
 * tab), an open page would keep showing — and later re-save — the old copy.
 * The banner below lets you re-open the page on the new data; it is a prompt
 * rather than an automatic remount so text you are typing is never thrown away.
 */
export default function SyncProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [staleView, setStaleView] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    // Revisions make the first sync one small read, so this rarely fires.
    const guard = setTimeout(finish, 3000);

    const unsubscribeData = sync.subscribeData(() => {
      if (done) setStaleView(true);
    });

    sync
      .init()
      .catch(() => {})
      .finally(() => {
        clearTimeout(guard);
        finish();
      });

    // Save on the way out, and pick up other devices' changes on the way in.
    // iOS fires pagehide/visibilitychange reliably; beforeunload often not at all.
    const onHide = () => sync.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sync.flush();
      else void sync.refresh();
    };
    const onFocus = () => void sync.refresh();

    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(guard);
      unsubscribeData();
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex items-center gap-3 text-sm text-ink-300">
          <span className="w-4 h-4 rounded-full border-2 border-neon-500/30 border-t-neon-500 animate-spin" />
          Syncing your data…
        </div>
      </div>
    );
  }

  return (
    <>
      {staleView && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-neon-500/30 bg-ink-900/95 px-4 py-2.5 text-xs text-ink-200 shadow-lg"
        >
          Newer data arrived from another device.
          <button
            className="btn-primary text-xs px-3 py-1"
            onClick={() => {
              setStaleView(false);
              setGeneration((g) => g + 1);
            }}
          >
            Show it
          </button>
        </div>
      )}
      <div key={generation} className="contents">
        {children}
      </div>
    </>
  );
}

export function SyncBadge() {
  const [, force] = useState(0);
  useEffect(() => {
    const unsubscribe = sync.subscribe(() => force((n) => n + 1));
    return () => {
      unsubscribe();
    };
  }, []);
  const { state, error } = sync.getState();

  if (state === "expired") {
    return (
      <Link
        href="/login"
        title={error}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[11px] text-coral-400 hover:bg-ink-800 transition"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-coral-500" />
        Session expired — sign in to sync
      </Link>
    );
  }

  const map = {
    off: { dot: "bg-ink-600", label: "This device only", tone: "text-ink-400" },
    idle: { dot: "bg-neon-500", label: "Synced to cloud", tone: "text-ink-400" },
    syncing: { dot: "bg-amberx-500 animate-pulse", label: "Syncing…", tone: "text-ink-400" },
    error: { dot: "bg-coral-500", label: "Sync failed", tone: "text-coral-400" },
  }[state];

  return (
    <button
      onClick={() => void sync.init()}
      title={error || "Click to sync now"}
      className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[11px] hover:bg-ink-800 transition ${map.tone}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${map.dot}`} />
      {map.label}
    </button>
  );
}
