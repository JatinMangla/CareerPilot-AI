"use client";

import { store } from "./store";
import { quota } from "./quota";
import { stableStringify } from "./stableJson";

// Gemini's free tier is the only provider, so the daily cap always applies.
// This is a courtesy stop so you find out before Google starts refusing calls —
// it lives in localStorage and is not a security control.
function preGuard() {
  if (typeof window !== "undefined") quota.guard("gemini");
}

function trackProvider(res: Response) {
  if (typeof window === "undefined") return;
  if (res.headers.get("x-ai-provider") === "gemini") quota.bump("gemini");
}

/**
 * Calls /api/ai with a task. Two modes:
 *  - streamTask: streams plain text chunks via onChunk, resolves with full text
 *  - jsonTask:   resolves with parsed JSON of type T
 * The current self-improvement strategy addendum is attached automatically.
 */

export async function streamTask(
  task: string,
  input: Record<string, unknown>,
  onChunk: (fullTextSoFar: string) => void,
  signal?: AbortSignal
): Promise<string> {
  preGuard();
  const strategy = store.getStrategy();
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, input, strategyAddendum: strategy.systemAddendum }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error((await safeError(res)) || `AI request failed (${res.status})`);
  }
  trackProvider(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onChunk(full);
  }
  return full;
}

/**
 * Identical JSON requests already in flight, so a double-click or a React strict
 * mode double-invoke costs one API call instead of two. Cleared in `finally`, so
 * a second call after the first settles starts fresh.
 */
const inFlight = new Map<string, Promise<unknown>>();

export interface TaskOptions {
  signal?: AbortSignal;
  /** Bypass the server-side response cache — for an explicit "regenerate". */
  fresh?: boolean;
}

export async function jsonTask<T>(
  task: string,
  input: Record<string, unknown>,
  options?: AbortSignal | TaskOptions
): Promise<T> {
  // Kept back-compatible: callers used to pass an AbortSignal positionally.
  const opts: TaskOptions =
    options instanceof AbortSignal ? { signal: options } : options ?? {};

  preGuard();
  const strategy = store.getStrategy();
  const payload = {
    task,
    input,
    strategyAddendum: strategy.systemAddendum,
    ...(opts.fresh ? { fresh: true } : {}),
  };

  // A request carrying an abort signal is owned by one caller, so sharing its
  // promise would let one component's abort cancel another's result.
  const key = opts.signal || opts.fresh ? null : stableStringify(payload);
  if (key) {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
  }

  const run = (async () => {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: opts.signal,
    });
    if (!res.ok) {
      throw new Error((await safeError(res)) || `AI request failed (${res.status})`);
    }
    trackProvider(res);
    return (await res.json()) as T;
  })();

  if (!key) return run;

  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const data = await res.json();
    return data?.error || null;
  } catch {
    return null;
  }
}
