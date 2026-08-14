"use client";

import { useEffect } from "react";

/**
 * Without this, an uncaught render error shows Next.js's default screen and
 * tells you nothing — which is exactly what a malformed AI response used to do.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ui] unhandled error", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] grid place-items-center p-4">
      <div className="card-pad max-w-lg space-y-4">
        <h1 className="h2">Something broke on this page</h1>
        <p className="text-sm text-ink-300 leading-relaxed">
          Your data is safe — it&apos;s stored separately from the page. This is usually a
          one-off: an AI response that came back in an unexpected shape, or a network
          hiccup.
        </p>
        <p className="text-xs text-ink-400 font-mono bg-ink-850 rounded-xl p-3 break-words">
          {error.message || "Unknown error"}
          {error.digest ? ` (${error.digest})` : ""}
        </p>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-primary" onClick={reset}>
            Try again
          </button>
          <a className="btn-secondary" href="/">
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
