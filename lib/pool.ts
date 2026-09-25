/**
 * Bounded-concurrency map.
 *
 * The AI-heavy flows used to await one call at a time: Auto-Apply prepared up to
 * ten jobs sequentially on the `deep` tier, and Inbox classified mail twelve at a
 * time, one batch after another. Both spent most of their wall-clock time waiting
 * on a network round trip that could have been overlapped.
 *
 * The limit is deliberately small. Gemini's free tier is rate-limited per minute,
 * and lib/gemini.ts already walks down a chain of weaker models on a 429, so a
 * burst does not fail loudly — it quietly returns worse output. Three in flight
 * is roughly a 3x speed-up while staying under that ceiling.
 */

export interface PoolOutcome<T, R> {
  item: T;
  index: number;
  value?: R;
  error?: Error;
  /** Never started because the run was cancelled. */
  skipped?: boolean;
}

/** How many AI calls may be in flight at once. See the note above before raising. */
export const AI_CONCURRENCY = 3;

/**
 * Runs `fn` over `items` with at most `limit` in flight.
 *
 * Results come back in input order regardless of completion order, and one
 * failure does not cancel the rest — a single unlucky job must not throw away
 * nine good ones. Inspect `error` on each outcome.
 *
 * `onSettled` fires as each item finishes, for progress display. It reports a
 * completed COUNT, not a position: with overlapping calls, "item 4 of 10" is
 * meaningless but "4 of 10 done" is not.
 *
 * `signal` makes a run cancellable: nothing new starts once it aborts, and the
 * signal is handed to `fn` so in-flight calls can stop too. Items that never ran
 * come back with `skipped: true`. Without this a cancelled 25-job run kept
 * spending the day's free quota after you had moved on.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number, signal?: AbortSignal) => Promise<R>,
  onSettled?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<PoolOutcome<T, R>[]> {
  const total = items.length;
  const results: PoolOutcome<T, R>[] = new Array(total);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= total) return;
      if (signal?.aborted) {
        results[index] = { item: items[index], index, skipped: true };
        continue;
      }
      try {
        results[index] = { item: items[index], index, value: await fn(items[index], index, signal) };
      } catch (err) {
        if (signal?.aborted) {
          // Stopped by the cancel, not failed — the caller must not record an error.
          results[index] = { item: items[index], index, skipped: true };
          done++;
          onSettled?.(done, total);
          continue;
        }
        results[index] = {
          item: items[index],
          index,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
      done++;
      onSettled?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, total)) }, worker));
  return results;
}
