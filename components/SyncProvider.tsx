"use client";

import { useEffect, useState } from "react";
import { sync } from "@/lib/store";

/**
 * Loads server state before the app renders, so every page reads the same data
 * regardless of which device you're on. Falls through quickly if the database
 * isn't configured or is slow — the app must never be blocked by sync.
 */
export default function SyncProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    // Never block the UI for more than a moment.
    const guard = setTimeout(finish, 6000);

    sync.stampExistingLocalData();
    sync
      .init()
      .catch(() => {})
      .finally(() => {
        clearTimeout(guard);
        finish();
      });

    // Push anything pending when leaving or backgrounding the tab.
    const flush = () => void sync.pushNow();
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
      if (document.visibilityState === "visible") void sync.init();
    });
    return () => {
      clearTimeout(guard);
      window.removeEventListener("beforeunload", flush);
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

  return <>{children}</>;
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
