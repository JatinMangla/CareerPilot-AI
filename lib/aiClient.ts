"use client";

import { store } from "./store";
import { quota } from "./quota";
import { stableStringify } from "./stableJson";

/**
 * Keeps the usage banner current. The server counts every request it sends to
 * Gemini (fallbacks included, across all devices) and reports the total in
 * x-ai-usage; without Redis it cannot, and this device counts for itself.
 */
function trackUsage(res: Response) {
  if (typeof window === "undefined") return;
  const used = res.headers.get("x-ai-usage");
  if (used !== null) quota.report("gemini", Number(used) || 0);
  else if (res.headers.get("x-ai-provider") === "gemini") quota.bump("gemini");
}

/** Which model answered, from the stream trailer or the JSON response headers. */
export interface AiMeta {
  model: string;
  /** The tier's first-choice model was busy and a weaker one answered. */
  fallback: boolean;
}

/**
 * A stream that ended before the model finished — token limit, safety block,
 * a dropped connection. `partial` is what arrived; it must not be saved as if
 * it were whole.
 */
export class IncompleteStreamError extends Error {
  constructor(public partial: string, reason: string) {
    super(
      reason === "MAX_TOKENS"
        ? "The AI ran out of room before finishing, so this text is incomplete. Try again, or shorten the input."
        : reason === "SAFETY" || reason === "RECITATION" || reason === "BLOCKLIST"
        ? "The AI stopped partway (content filter), so this text is incomplete. Try again."
        : "The AI connection dropped before it finished, so this text is incomplete. Try again."
    );
    this.name = "IncompleteStreamError";
  }
}

const META = "[[CP_META:";
const ERROR = "[[CP_ERROR:";

/** Text with any trailer (or a trailer still arriving) removed. */
function visible(full: string): string {
  const at = full.lastIndexOf("\n[[CP_");
  if (at >= 0) return full.slice(0, at);
  // The marker may be split across chunks; hold back a trailing fragment of it.
  const tail = full.lastIndexOf("\n[[");
  if (tail >= 0 && full.length - tail < 12) return full.slice(0, tail);
  return full;
}

export interface StreamOptions {
  signal?: AbortSignal;
  /**
   * Return a cut-off stream instead of throwing. For conversational turns, where
   * half an answer is still useful; never for text that gets saved.
   */
  allowIncomplete?: boolean;
  onMeta?: (meta: AiMeta) => void;
}

/**
 * Calls /api/ai with a task. Two modes:
 *  - streamTask: streams plain text chunks via onChunk, resolves with full text.
 *    Throws IncompleteStreamError when the stream did not finish.
 *  - jsonTask:   resolves with parsed JSON of type T
 * The current self-improvement strategy addendum is attached automatically.
 */
export async function streamTask(
  task: string,
  input: Record<string, unknown>,
  onChunk: (fullTextSoFar: string) => void,
  options?: AbortSignal | StreamOptions
): Promise<string> {
  // Kept back-compatible: callers used to pass an AbortSignal positionally.
  const opts: StreamOptions =
    options instanceof AbortSignal ? { signal: options } : options ?? {};
  const strategy = store.getStrategy();
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, input, strategyAddendum: strategy.systemAddendum }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error((await safeError(res)) || `AI request failed (${res.status})`);
  }
  trackUsage(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onChunk(visible(full));
  }

  const errAt = full.lastIndexOf(ERROR);
  if (errAt >= 0) {
    throw new Error(full.slice(errAt + ERROR.length).replace(/\]\]\s*$/, "").trim());
  }

  const text = visible(full).trim();
  const metaAt = full.lastIndexOf(META);
  let finish = "DROPPED";
  if (metaAt >= 0) {
    try {
      const meta = JSON.parse(full.slice(metaAt + META.length).replace(/\]\]\s*$/, ""));
      finish = meta.finish || "STOP";
      opts.onMeta?.({ model: meta.model, fallback: !!meta.fallback });
    } catch {
      /* a malformed trailer is treated as a dropped stream */
    }
  }
  if (finish !== "STOP" && !opts.allowIncomplete) {
    throw new IncompleteStreamError(text, finish);
  }
  return text;
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
    const data = (await res.json()) as T;
    // After the result is safely in hand: a failure to record usage must never
    // cost the answer that was already paid for.
    try {
      trackUsage(res);
    } catch {
      /* usage display only */
    }
    return data;
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
