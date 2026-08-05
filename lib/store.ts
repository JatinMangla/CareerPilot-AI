"use client";

import type {
  ResumeData,
  Profile,
  ValidationResult,
  Job,
  PreparedApplication,
  QueuedApplication,
  SentEmail,
  InboxMessage,
  OutreachDraft,
  Strategy,
  UsageStats,
} from "./types";

const KEYS = {
  resume: "cp_resume",
  profile: "cp_profile",
  validation: "cp_validation",
  jobs: "cp_jobs",
  apps: "cp_apps",
  queue: "cp_queue",
  emails: "cp_emails",
  inbox: "cp_inbox",
  lastSync: "cp_last_sync",
  draft: "cp_outreach_draft",
  strategy: "cp_strategy",
  stats: "cp_stats",
} as const;

/* ------------------------------------------------------------------ *
 * Cross-device sync
 *
 * localStorage stays the instant, synchronous cache so every page keeps
 * its simple `store.getX()` API. Each write also stamps the key and
 * schedules a debounced push to the server, and `pull()` merges anything
 * newer that another device wrote. Last write wins, per key.
 * ------------------------------------------------------------------ */

const META_KEY = "cp_meta"; // { [key]: lastModified }
const DEVICE_ONLY = new Set<string>(["cp_outreach_draft", "cp_meta"]);

type SyncState = "off" | "idle" | "syncing" | "error";
let syncState: SyncState = "off";
let syncError = "";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
const dirty = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore listener errors */
    }
  });
}

function setSyncState(s: SyncState, err = "") {
  syncState = s;
  syncError = err;
  notify();
}

function readMeta(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(META_KEY) || "{}");
  } catch {
    return {};
  }
}

function stamp(key: string, at = Date.now()) {
  if (typeof window === "undefined") return;
  const meta = readMeta();
  meta[key] = at;
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  if (DEVICE_ONLY.has(key)) return;
  stamp(key);
  dirty.add(key);
  schedulePush();
}

function schedulePush(delay = 1200) {
  if (typeof window === "undefined" || syncState === "off") return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

/** Collects the pending changes as a payload, without clearing them. */
function pendingPayload(): Record<string, { value: unknown; at: number }> | null {
  if (typeof window === "undefined" || dirty.size === 0) return null;
  const meta = readMeta();
  const data: Record<string, { value: unknown; at: number }> = {};
  for (const k of Array.from(dirty)) {
    const raw = window.localStorage.getItem(k);
    if (raw === null) continue;
    try {
      data[k] = { value: JSON.parse(raw), at: meta[k] || Date.now() };
    } catch {
      /* skip unparseable */
    }
  }
  return Object.keys(data).length ? data : null;
}

/**
 * Last-gasp save when the page is being hidden or torn down.
 *
 * iOS Safari frequently kills in-flight fetches (and often skips `beforeunload`
 * entirely) when you swipe away or switch apps, so a normal push can be lost.
 * sendBeacon is queued by the browser and delivered regardless.
 */
function flushBeacon(): void {
  if (typeof window === "undefined" || syncState === "off") return;
  const data = pendingPayload();
  if (!data) return;
  const body = JSON.stringify({ data });
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/state", blob)) {
      dirty.clear();
      return;
    }
  } catch {
    /* fall through to keepalive fetch */
  }
  // keepalive lets the request outlive the page in browsers without sendBeacon
  fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  })
    .then(() => dirty.clear())
    .catch(() => {});
}

/** Send locally-changed keys to the server. */
async function push(): Promise<void> {
  if (typeof window === "undefined" || syncState === "off" || dirty.size === 0) return;
  const keys = Array.from(dirty);
  const data = pendingPayload();
  dirty.clear();
  if (!data) return;

  setSyncState("syncing");
  try {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      keys.forEach((k) => dirty.add(k)); // retry on the next write
      setSyncState("error", d.error || `Sync failed (${res.status})`);
      return;
    }
    setSyncState("idle");
  } catch (err: any) {
    keys.forEach((k) => dirty.add(k));
    setSyncState("error", err.message);
  }
}

/**
 * Pull server state and merge. Returns true if anything local changed, so the
 * caller can refresh the UI.
 */
async function pull(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  setSyncState("syncing");
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));

    if (!payload?.configured) {
      setSyncState("off");
      return false;
    }
    if (!res.ok) {
      setSyncState("error", payload.error || `Sync failed (${res.status})`);
      return false;
    }

    const meta = readMeta();
    const server: Record<string, { value: unknown; at: number }> = payload.data || {};
    let changed = false;

    for (const [key, entry] of Object.entries(server)) {
      if (DEVICE_ONLY.has(key)) continue;
      const localAt = meta[key] ?? -1;
      if ((entry?.at ?? 0) > localAt) {
        window.localStorage.setItem(key, JSON.stringify(entry.value));
        stamp(key, entry.at);
        changed = true;
      }
    }

    // Anything this device has that the server doesn't (or has staler) goes up —
    // this is what carries an existing browser's data into the database.
    for (const [key, at] of Object.entries(readMeta())) {
      if (DEVICE_ONLY.has(key)) continue;
      if (!server[key] || (server[key].at ?? 0) < at) dirty.add(key);
    }

    setSyncState("idle");
    if (dirty.size) await push();
    return changed;
  } catch (err: any) {
    setSyncState("error", err.message);
    return false;
  }
}

let lastPullAt = 0;

export const sync = {
  /** Called once on app start. */
  init: pull,
  /** Pull, but skip if we just did — for rapid tab/app switching. */
  refresh: async () => {
    if (Date.now() - lastPullAt < 8000) return false;
    lastPullAt = Date.now();
    return pull();
  },
  pushNow: () => push(),
  /** Save immediately and durably; safe to call while the page is closing. */
  flush: flushBeacon,
  getState: () => ({ state: syncState, error: syncError }),
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /**
   * First run on a device that already has local data: make sure every key is
   * stamped so it gets uploaded rather than silently ignored.
   */
  stampExistingLocalData() {
    if (typeof window === "undefined") return;
    const meta = readMeta();
    let touched = false;
    for (const key of Object.values(KEYS)) {
      if (DEVICE_ONLY.has(key)) continue;
      if (window.localStorage.getItem(key) !== null && meta[key] === undefined) {
        meta[key] = Date.now();
        touched = true;
      }
    }
    if (touched) window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  },
};

export const defaultProfile: Profile = {
  name: "Jatin Mangla",
  email: "jatinmangla123@gmail.com",
  role: "Frontend Web Developer",
  skills: [
    "JavaScript",
    "TypeScript",
    "HTML",
    "CSS",
    "React",
    "Tailwind CSS",
    "Redux",
    "Git",
    "Node.js (basics)",
  ],
  locations: "India (Remote / Hybrid)",
  desiredRoles: "Frontend Developer, React Developer, UI Engineer",
  portals: ["LinkedIn", "Naukri", "Indeed", "Wellfound"],
  phone: "",
  linkedin: "",
  github: "",
  portfolio: "",
  noticePeriod: "",
  expectedCtc: "",
};

export const defaultStrategy: Strategy = {
  version: 1,
  systemAddendum: "",
  notes: ["Baseline strategy — run Evolve to optimize."],
  updatedAt: Date.now(),
};

export const defaultStats: UsageStats = {
  improvements: 0,
  validations: 0,
  tailors: 0,
  jobsAnalyzed: 0,
  applicationsPrepared: 0,
  interviews: 0,
  practiceSolved: 0,
};

export const store = {
  getResume: () => read<ResumeData | null>(KEYS.resume, null),
  setResume: (r: ResumeData) => write(KEYS.resume, r),

  getProfile: () => read<Profile>(KEYS.profile, defaultProfile),
  setProfile: (p: Profile) => write(KEYS.profile, p),

  getValidation: () => read<ValidationResult | null>(KEYS.validation, null),
  setValidation: (v: ValidationResult) => write(KEYS.validation, v),

  getJobs: () => read<Job[]>(KEYS.jobs, []),
  setJobs: (j: Job[]) => write(KEYS.jobs, j),

  getApps: () => read<PreparedApplication[]>(KEYS.apps, []),
  setApps: (a: PreparedApplication[]) => write(KEYS.apps, a),

  getQueue: () => read<QueuedApplication[]>(KEYS.queue, []),
  setQueue: (q: QueuedApplication[]) => write(KEYS.queue, q),

  getEmails: () => read<SentEmail[]>(KEYS.emails, []),
  setEmails: (e: SentEmail[]) => write(KEYS.emails, e),

  getInbox: () => read<InboxMessage[]>(KEYS.inbox, []),
  setInbox: (m: InboxMessage[]) => write(KEYS.inbox, m),

  getLastSync: () => read<string | null>(KEYS.lastSync, null),
  setLastSync: (iso: string) => write(KEYS.lastSync, iso),

  /** Hand a prefilled draft to the Outreach page. */
  setDraft: (d: OutreachDraft) => write(KEYS.draft, d),
  takeDraft: (): OutreachDraft | null => {
    const d = read<OutreachDraft | null>(KEYS.draft, null);
    if (d && typeof window !== "undefined") window.localStorage.removeItem(KEYS.draft);
    return d;
  },

  getStrategy: () => read<Strategy>(KEYS.strategy, defaultStrategy),
  setStrategy: (s: Strategy) => write(KEYS.strategy, s),

  getStats: () => read<UsageStats>(KEYS.stats, defaultStats),
  bumpStat: (k: keyof UsageStats, by = 1) => {
    const s = read<UsageStats>(KEYS.stats, defaultStats);
    s[k] = (s[k] || 0) + by;
    write(KEYS.stats, s);
    return s;
  },
};
