"use client";

import type {
  ResumeData,
  Profile,
  ValidationResult,
  Job,
  PreparedApplication,
  QueuedApplication,
  SentEmail,
  ReferralRecord,
  InboxMessage,
  OutreachDraft,
  Strategy,
  UsageStats,
  ImprovementBrief,
} from "./types";

const KEYS = {
  resume: "cp_resume",
  profile: "cp_profile",
  validation: "cp_validation",
  jobs: "cp_jobs",
  apps: "cp_apps",
  queue: "cp_queue",
  emails: "cp_emails",
  referrals: "cp_referrals",
  inbox: "cp_inbox",
  lastSync: "cp_last_sync",
  draft: "cp_outreach_draft",
  brief: "cp_improve_brief",
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

/** localStorage is capped (~5MB on iOS). Never let a full quota throw into React. */
function safeSet(key: string, raw: string): boolean {
  try {
    window.localStorage.setItem(key, raw);
    return true;
  } catch (err) {
    console.error(`[store] could not save "${key}" — storage full?`, err);
    setSyncState(
      "error",
      "This device's storage is full. Older Job Inbox mail is the usual cause — sync still works on your other devices."
    );
    return false;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  if (!safeSet(key, JSON.stringify(value))) return;
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

  // NOTE: we deliberately do NOT clear `dirty` here.
  //
  // sendBeacon returning true only means the browser queued the request — it
  // says nothing about the server accepting it, and a keepalive fetch can still
  // fail. Clearing on a queued-but-unconfirmed send meant a 502 (or Redis being
  // down) silently discarded the pending changes: the data survived only in
  // localStorage, no longer marked as needing an upload. Leaving the keys dirty
  // costs one redundant re-send next time and cannot lose anything. The server
  // merge is timestamp-based, so re-sending is harmless.
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/state", blob)) return;
  } catch {
    /* fall through to keepalive fetch */
  }
  fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
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
        // Keep going if one key fails — a partially-applied merge that aborts
        // mid-loop leaves later keys stale with no indication why.
        if (safeSet(key, JSON.stringify(entry.value))) {
          stamp(key, entry.at);
          changed = true;
        }
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

/**
 * Baseline strategy, injected into every AI task.
 *
 * This is no longer an empty placeholder: it encodes the hiring evidence the
 * app is built around, so output is grounded from the first run rather than
 * only after the user remembers to hit Evolve.
 */
export const defaultStrategy: Strategy = {
  version: 2,
  systemAddendum: `CHANNEL REALITY — weight every recommendation by this. Cold portal applications convert at 1-2%; employee referrals convert at ~30% and are 4-10x the interview rate. Referrals are ~7% of applicants but 30-50% of hires. 75% of resumes are filtered before a human reads them. So: never advise "apply to more roles" as a fix for low response; advise a referral route, a warm intro, or a better-targeted application instead. Volume is not the lever; conversion is.

RESUME. Single column, no tables/columns/graphics/headshots — multi-column layouts get mis-parsed by ATS and rejected before review. Mirror the exact noun phrases from the job description ("React Native", not "mobile development"). Every bullet leads with a concrete outcome and a number where one honestly exists: "cut initial bundle 40% (2.1MB to 1.3MB)", "dashboard used by 200+ internal users". Never invent a metric — if none exists, lead with the technical decision and its effect. Cut every line that would be true of any developer.

GITHUB AND PORTFOLIO. Recruiters open GitHub before the resume for frontend roles, and a tidy profile is worth roughly +40% callbacks. Treat it as part of the application: pinned repos relevant to the target role, one-line descriptions, READMEs with a live demo link and a screenshot, no practice/test repos on display. A working deployed link beats another resume bullet.

INDIAN MARKET, REACT ROLES. React demand is growing (~18% YoY) and is the strongest keyword to lead with. Product companies and funded startups weight shipped work and a practical round far above degree or CTC history; service companies weight notice period and years. Salary framing: quote a range, anchor on total CTC, and treat a 30-40% jump as normal when changing companies with in-demand skills.

INTERVIEWS. Frontend loops are dominated by a 45-60 minute practical round — fetch an API and render a filterable/sortable list, handle loading/empty/error states, debounce input — not algorithm puzzles. Coach component decomposition, state modelling, and narrating trade-offs out loud. Behavioural answers use situation, action, measurable result, in that order, in under 90 seconds.

OUTREACH. Recruiters and engineers skim on a phone. Under 160 words, no "I hope this finds you well", two concrete proof points, one low-friction ask, and something checkable that shows the message was written for them specifically.`,
  notes: [
    "Baseline v2 — grounded in 2026 conversion data rather than generic advice.",
    "Referral-first: cold applications convert at 1-2%, referrals at ~30%.",
    "Treats GitHub as part of the application, not an afterthought.",
    "Interview coaching targets practical component rounds, not algorithm puzzles.",
    "Run Evolve, or Two-brain mode, to tune this further to your own results.",
  ],
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

  getReferrals: () => read<ReferralRecord[]>(KEYS.referrals, []),
  setReferrals: (r: ReferralRecord[]) => write(KEYS.referrals, r),

  getInbox: () => read<InboxMessage[]>(KEYS.inbox, []),
  setInbox: (m: InboxMessage[]) => write(KEYS.inbox, m),

  getLastSync: () => read<string | null>(KEYS.lastSync, null),
  setLastSync: (iso: string) => write(KEYS.lastSync, iso),

  /**
   * Hand the fixes from Validate Resume to the "Improve with AI" panel.
   *
   * Unlike the outreach draft this is not consumed on read — it stays until
   * you clear it, so you can re-run the improvement or edit the list first.
   */
  getBrief: () => read<ImprovementBrief | null>(KEYS.brief, null),
  setBrief: (b: ImprovementBrief) => write(KEYS.brief, b),
  clearBrief: () => write<ImprovementBrief | null>(KEYS.brief, null),

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
