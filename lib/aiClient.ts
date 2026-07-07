"use client";

import { store } from "./store";
import { quota } from "./quota";

function preGuard() {
  // Only guard the free tier — if the server last used Claude, no limit applies here.
  if (typeof window !== "undefined" && window.localStorage.getItem("cp_last_provider") === "gemini") {
    quota.guard("gemini");
  }
}

function trackProvider(res: Response) {
  const provider = res.headers.get("x-ai-provider");
  if (!provider || typeof window === "undefined") return;
  window.localStorage.setItem("cp_last_provider", provider);
  if (provider === "gemini") quota.bump("gemini");
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

export async function jsonTask<T>(
  task: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  preGuard();
  const strategy = store.getStrategy();
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, input, strategyAddendum: strategy.systemAddendum }),
    signal,
  });
  if (!res.ok) {
    throw new Error((await safeError(res)) || `AI request failed (${res.status})`);
  }
  trackProvider(res);
  return (await res.json()) as T;
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const data = await res.json();
    return data?.error || null;
  } catch {
    return null;
  }
}
