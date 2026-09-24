"use client";

/**
 * Free-tier usage display. Warns as you approach a free limit.
 *
 * It no longer hard-stops. The pause counted one click per device, so it could
 * not see fallback retries, other devices, or the fact that each model in a
 * chain has its own daily allowance — it blocked calls Gemini would have served.
 * Gemini's own 429 is the real limit, and lib/gemini.ts already turns it into a
 * clear message. The Gemini count now comes from the server (every upstream
 * request, all devices) whenever Redis is connected.
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

/** Free-tier quotas reset at midnight Pacific, so the day is counted in Pacific time. */
function periodKey(period: "day" | "month"): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    new Date()
  );
  return period === "day" ? day : day.slice(0, 7);
}

function read(key: string): { period: string; count: number } {
  if (typeof window === "undefined") return { period: "", count: 0 };
  try {
    return JSON.parse(window.localStorage.getItem(`cp_quota_${key}`) || "null") || { period: "", count: 0 };
  } catch {
    return { period: "", count: 0 };
  }
}

function save(key: string, value: { period: string; count: number }) {
  try {
    window.localStorage.setItem(`cp_quota_${key}`, JSON.stringify(value));
  } catch {
    /* a full disk must not break the call this is counting */
  }
}

export const quota = {
  /** This device's own count — used only when the server cannot count. */
  bump(key: QuotaInfo["key"], by = 1) {
    const def = LIMITS[key];
    const pk = periodKey(def.period);
    const cur = read(key);
    save(key, { period: pk, count: cur.period === pk ? cur.count + by : by });
  },

  /** The authoritative count, as reported by the server. */
  report(key: QuotaInfo["key"], used: number) {
    save(key, { period: periodKey(LIMITS[key].period), count: used });
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
};
