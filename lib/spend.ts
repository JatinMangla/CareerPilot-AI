import { kvConfigured, hincrbyFloat, hgetallRaw } from "./kv";

/**
 * Server-side spend guard for the paid AI path.
 *
 * The client-side counter in lib/quota.ts is decorative — it lives in
 * localStorage, resets when site data is cleared, isn't shared between devices,
 * and can be skipped entirely by calling /api/ai directly. This one runs on the
 * server, is shared across every device, and is the thing standing between a
 * mis-click and a surprise invoice.
 *
 * Counters live in a per-day Redis hash so they expire naturally by key name.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** USD per million tokens, by model. */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

export function dailyLimitUsd(): number {
  const raw = Number(process.env.AI_DAILY_USD_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

function todayKey(): string {
  return `careerpilot:spend:${new Date().toISOString().slice(0, 10)}`;
}

export function estimateUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = PRICING[model] || PRICING["claude-sonnet-5"];
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}

export interface SpendStatus {
  spentUsd: number;
  limitUsd: number;
  calls: number;
  /** True when the caller should be refused. */
  exceeded: boolean;
  /** Set when the counter itself is unavailable (fail-open, but reported). */
  degraded?: string;
}

export async function getSpend(): Promise<SpendStatus> {
  const limitUsd = dailyLimitUsd();
  if (!kvConfigured()) {
    return { spentUsd: 0, limitUsd, calls: 0, exceeded: false, degraded: "no database" };
  }
  try {
    const raw = await hgetallRaw(todayKey());
    const spentUsd = Number(raw.usd || 0);
    const calls = Number(raw.calls || 0);
    return { spentUsd, limitUsd, calls, exceeded: spentUsd >= limitUsd };
  } catch (err: any) {
    // Never block real work because the meter is down — but say so.
    return {
      spentUsd: 0,
      limitUsd,
      calls: 0,
      exceeded: false,
      degraded: err?.message || "counter unavailable",
    };
  }
}

/** Records one completed call. Failures here must never break the response. */
export async function recordSpend(
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  if (!kvConfigured()) return;
  const usd = estimateUsd(model, inputTokens, outputTokens);
  try {
    const key = todayKey();
    await hincrbyFloat(key, [
      ["usd", usd],
      ["calls", 1],
      ["inputTokens", inputTokens],
      ["outputTokens", outputTokens],
    ]);
    // Expire the counter a week later so old days don't accumulate.
    await import("./kv").then((m) => m.expire(key, Math.round((7 * DAY_MS) / 1000)));
  } catch (err) {
    console.error("[spend] failed to record usage", err);
  }
}
