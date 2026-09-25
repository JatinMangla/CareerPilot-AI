"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * One cancellable run at a time, per component.
 *
 * `start()` aborts any run still going and hands out a fresh signal; `cancel()`
 * is the Stop button; leaving the page cancels too. Long AI batches (25 tailoring
 * passes, a 40-job analysis, a backlog of inbox mail) had no way to stop and kept
 * spending the day's free quota after you had navigated away.
 */
export function useCancellable() {
  const ref = useRef<AbortController | null>(null);
  useEffect(() => () => ref.current?.abort(), []);

  const start = useCallback(() => {
    ref.current?.abort();
    ref.current = new AbortController();
    return ref.current.signal;
  }, []);
  const cancel = useCallback(() => ref.current?.abort(), []);

  return { start, cancel };
}
