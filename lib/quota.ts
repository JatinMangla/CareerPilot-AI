"use client";

/**
 * Free-tier usage guard. Counts calls client-side (single-user app) so you get
 * warned BEFORE crossing a free limit, and hard-stopped at the limit.
 * None of these services can bill you unless you attach a card / enable billing —
 * this guard is about avoiding hard stops and keeping usage comfortably free.
 */

export interface QuotaInfo {
  key: "gemini" | "jobsApi";
  label: string;
  used: number;
  limit: number;
  period: "day" | "month";
  warnAt: number; // fraction, e.g. 0.8
}

const LIMITS: Record<QuotaInfo["key"], { label: string; limit: number; period: "day" | "month"; warnAt: number }> = {
  gemini: { label: "Gemini AI calls (free tier)", limit: 250, period: "day", warnAt: 0.8 },
  jobsApi: { label: "Job search API calls (free credits)", limit: 200, period: "month", warnAt: 0.75 },
};

function periodKey(period: "day" | "month"): string {
  const d = new Date();
  return period === "day"
    ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    : `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function read(key: string): { period: string; count: number } {
  if (typeof window === "undefined") return { period: "", count: 0 };
  try {
    return JSON.parse(window.localStorage.getItem(`cp_quota_${key}`) || "null") || { period: "", count: 0 };
  } catch {
    return { period: "", count: 0 };
  }
}

export const quota = {
  bump(key: QuotaInfo["key"], by = 1) {
    const def = LIMITS[key];
    const pk = periodKey(def.period);
    const cur = read(key);
    const count = cur.period === pk ? cur.count + by : by;
    window.localStorage.setItem(`cp_quota_${key}`, JSON.stringify({ period: pk, count }));
  },

  get(key: QuotaInfo["key"]): QuotaInfo {
    const def = LIMITS[key];
    const pk = periodKey(def.period);
    const cur = read(key);
    return {
      key,
      label: def.label,
      used: cur.period === pk ? cur.count : 0,
      limit: def.limit,
      period: def.period,
      warnAt: def.warnAt,
    };
  },

  all(): QuotaInfo[] {
    return (Object.keys(LIMITS) as QuotaInfo["key"][]).map((k) => quota.get(k));
  },

  /** Throws a friendly error if the free limit is already reached. */
  guard(key: QuotaInfo["key"]) {
    const q = quota.get(key);
    if (q.used >= q.limit) {
      throw new Error(
        `Free limit reached: ${q.label} — ${q.used}/${q.limit} this ${q.period}. ` +
          `It resets next ${q.period === "day" ? "day" : "month"}; no bill will be generated, requests are simply paused.`
      );
    }
  },
};
