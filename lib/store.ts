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
  InboxCursor,
  OutreachDraft,
  Strategy,
  UsageStats,
  ImprovementBrief,
  DismissedJob,
} from "./types";
import { fingerprint, sourceRank } from "./jobFilters";
import { diffList, hashList, isCollection, type IncomingEntry } from "./syncMerge";

const KEYS = {
  resume: "cp_resume",
  profile: "cp_profile",
  validation: "cp_validation",
  jobs: "cp_jobs",
  dismissed: "cp_dismissed",
  apps: "cp_apps",
  queue: "cp_queue",
  emails: "cp_emails",
  referrals: "cp_referrals",
  inbox: "cp_inbox",
  lastSync: "cp_last_sync",
  inboxCursor: "cp_inbox_cursor",
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
 * newer that another device wrote. The merge rules are in lib/syncMerge.ts.
 * ------------------------------------------------------------------ */

const META_KEY = "cp_meta"; // { [key]: when this device last changed it }
const REV_KEY = "cp_sync_rev"; // { [key]: server revision this device last synced }
const DIRTY_KEY = "cp_sync_dirty"; // keys changed here that the server has not confirmed
const BASE_KEY = "cp_sync_base"; // lists only: { [key]: { id: hash } } as last synced
const DEVICE_ONLY = new Set<string>(["cp_outreach_draft", META_KEY, REV_KEY, DIRTY_KEY, BASE_KEY]);

/**
 * "expired" is not "off". A 401 used to read as "no database", which switched
 * sync off for the rest of the session while the badge said "This device only" —
 * every later change quietly stayed on one device.
 */
type SyncState = "off" | "idle" | "syncing" | "error" | "expired";
let syncState: SyncState = "off";
let syncError = "";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing: Promise<void> | null = null;
const listeners = new Set<() => void>();
const dataListeners = new Set<(keys: string[]) => void>();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore listener errors */
    }
  });
}

/** Tells open pages that another device's data just replaced theirs. */
function notifyData(keys: string[]) {
  dataListeners.forEach((fn) => {
    try {
      fn(keys);
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
      "This device's storage is full, so the last change was not saved here. The Job Inbox is the usual cause — a sync there trims old non-job mail."
    );
    return false;
  }
}

const readMeta = () => read<Record<string, number>>(META_KEY, {});
const saveMeta = (m: Record<string, number>) => safeSet(META_KEY, JSON.stringify(m));
const readRevs = () => read<Record<string, number>>(REV_KEY, {});
const saveRevs = (r: Record<string, number>) => safeSet(REV_KEY, JSON.stringify(r));
const readDirty = () => new Set(read<string[]>(DIRTY_KEY, []));
const saveDirty = (d: Set<string>) => safeSet(DIRTY_KEY, JSON.stringify(Array.from(d)));

/** Records what a list looked like when it last matched the server. */
function saveBase(key: string, value: unknown) {
  if (!isCollection(key)) return;
  const base = read<Record<string, Record<string, string>>>(BASE_KEY, {});
  base[key] = hashList(key, value);
  safeSet(BASE_KEY, JSON.stringify(base));
}

/**
 * The unsynced set is persisted, not held in memory. In memory it died with the
 * tab — close the app offline and the change was never uploaded at all.
 * Returns false when the value could not be saved on this device.
 */
function write<T>(key: string, value: T): boolean {
  if (typeof window === "undefined") return false;
  if (!safeSet(key, JSON.stringify(value))) return false;
  if (DEVICE_ONLY.has(key)) return true;
  const meta = readMeta();
  meta[key] = Date.now();
  saveMeta(meta);
  const dirty = readDirty();
  if (!dirty.has(key)) {
    dirty.add(key);
    saveDirty(dirty);
  }
  schedulePush();
  return true;
}

function schedulePush(delay = 1200) {
  if (typeof window === "undefined" || syncState === "off" || syncState === "expired") return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

interface Pending {
  data: Record<string, IncomingEntry>;
  /** Each key's local timestamp when the payload was built. */
  snapshot: Record<string, number>;
}

/**
 * The unsynced changes as a payload. Lists go as patches — only the items that
 * changed since the last sync — which is also what keeps the beacon below its
 * 64KB limit: the whole inbox never fit, so its last-gasp save always failed.
 */
function pendingPayload(): Pending | null {
  if (typeof window === "undefined") return null;
  const dirty = readDirty();
  if (!dirty.size) return null;
  const meta = readMeta();
  const revs = readRevs();
  const base = read<Record<string, Record<string, string>>>(BASE_KEY, {});
  const data: Record<string, IncomingEntry> = {};
  const snapshot: Record<string, number> = {};
  let pruned = false;

  for (const k of Array.from(dirty)) {
    const raw = window.localStorage.getItem(k);
    let value: unknown;
    try {
      if (raw === null) throw new Error("gone");
      value = JSON.parse(raw);
    } catch {
      dirty.delete(k); // nothing left to send
      pruned = true;
      continue;
    }
    const at = meta[k] || Date.now();
    snapshot[k] = at;
    const baseRev = revs[k] ?? 0;
    data[k] = isCollection(k)
      ? { at, baseRev, patch: diffList(k, value, base[k]) }
      : { at, baseRev, value };
  }
  if (pruned) saveDirty(dirty);
  return Object.keys(data).length ? { data, snapshot } : null;
}

/** Applies the server's answer to a push: new revisions, and any merged values. */
function applyResults(
  results: Record<string, { rev: number; at: number; value?: unknown }>,
  snapshot: Record<string, number>
) {
  const meta = readMeta();
  const revs = readRevs();
  const dirty = readDirty();
  const changed: string[] = [];

  for (const [k, r] of Object.entries(results)) {
    // Changed again while the request was in flight: stay dirty, and keep the
    // old revision so the next push is merged rather than fast-forwarded.
    if (meta[k] !== snapshot[k]) continue;
    revs[k] = r.rev;
    if (r.value !== undefined) {
      if (!safeSet(k, JSON.stringify(r.value))) continue;
      meta[k] = r.at;
      saveBase(k, r.value);
      changed.push(k);
    } else {
      saveBase(k, read<unknown>(k, null));
    }
    dirty.delete(k);
  }
  saveMeta(meta);
  saveRevs(revs);
  saveDirty(dirty);
  if (changed.length) notifyData(changed);
}

function authExpired() {
  setSyncState(
    "expired",
    "Your session expired. Sign in again — changes made meanwhile are kept on this device and sync after."
  );
}

/**
 * Last-gasp save when the page is being hidden or torn down.
 *
 * iOS Safari frequently kills in-flight fetches (and often skips `beforeunload`
 * entirely) when you swipe away or switch apps, so a normal push can be lost.
 * sendBeacon is queued by the browser and delivered regardless. Nothing is
 * cleared here: a queued beacon is not a confirmed one, and the persisted dirty
 * set makes the next open re-send whatever did not land.
 */
function flushBeacon(): void {
  if (typeof window === "undefined" || syncState === "off" || syncState === "expired") return;
  const pending = pendingPayload();
  if (!pending) return;
  const body = JSON.stringify({ data: pending.data });
  // Both sendBeacon and keepalive fetch refuse bodies over 64KB. The next open
  // pushes it normally.
  if (body.length > 60_000) return;
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
  if (typeof window === "undefined" || syncState === "off" || syncState === "expired") return;
  if (pushing) {
    // One push at a time, or two could send the same patch against the same
    // revision and both be merged as conflicts.
    schedulePush();
    return;
  }
  const pending = pendingPayload();
  if (!pending) return;

  setSyncState("syncing");
  pushing = (async () => {
    try {
      const res = await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: pending.data }),
      });
      if (res.status === 401) return authExpired();
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncState("error", d.error || `Sync failed (${res.status})`);
        schedulePush(res.status === 409 ? 2000 : 15000);
        return;
      }
      applyResults(d.results || {}, pending.snapshot);
      setSyncState("idle");
    } catch (err: any) {
      setSyncState("error", err.message);
      schedulePush(15000);
    }
  })();
  try {
    await pushing;
  } finally {
    pushing = null;
  }
}

/**
 * Pull what other devices changed. Asks for revisions first and downloads only
 * the keys that moved, so a refresh on an unchanged account is one small read.
 * Returns true if anything local changed.
 */
async function pull(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  setSyncState("syncing");
  try {
    const res = await fetch("/api/state?revs=1", { cache: "no-store" });
    if (res.status === 401) {
      authExpired();
      return false;
    }
    const payload = await res.json().catch(() => null);
    if (payload?.configured === false) {
      setSyncState("off");
      return false;
    }
    if (!res.ok || !payload) {
      setSyncState("error", payload?.error || `Sync failed (${res.status})`);
      return false;
    }

    const serverRevs: Record<string, number> = payload.revs || {};
    const revs = readRevs();
    const meta = readMeta();
    const dirty = readDirty();
    const changed: string[] = [];

    // Anything only this device has goes up — how an existing browser's data
    // first reaches the database.
    for (const k of Object.values(KEYS)) {
      if (DEVICE_ONLY.has(k) || k in serverRevs) continue;
      if (window.localStorage.getItem(k) !== null) {
        dirty.add(k);
        if (meta[k] === undefined) meta[k] = Date.now();
      }
    }

    const needed = Object.keys(serverRevs).filter(
      (k) => !DEVICE_ONLY.has(k) && serverRevs[k] > (revs[k] ?? 0)
    );
    if (needed.length) {
      const res2 = await fetch(`/api/state?keys=${encodeURIComponent(needed.join(","))}`, {
        cache: "no-store",
      });
      if (res2.status === 401) {
        authExpired();
        return false;
      }
      const p2 = await res2.json().catch(() => null);
      if (!res2.ok || !p2) {
        setSyncState("error", p2?.error || `Sync failed (${res2.status})`);
        return false;
      }

      const rows = (p2.data || {}) as Record<string, { value: unknown; at: number; rev: number }>;
      for (const [k, entry] of Object.entries(rows)) {
        const localRev = revs[k] ?? 0;
        // Both sides changed since this device last synced: the push merges it
        // on the server and hands the result back.
        if (dirty.has(k) && localRev > 0) continue;
        // First sync since revisions existed, and this copy is the newer one:
        // send it on top of the server's revision instead of taking the older.
        if (
          localRev === 0 &&
          window.localStorage.getItem(k) !== null &&
          (meta[k] ?? -1) > entry.at
        ) {
          dirty.add(k);
          revs[k] = entry.rev;
          continue;
        }
        if (safeSet(k, JSON.stringify(entry.value))) {
          meta[k] = entry.at;
          revs[k] = entry.rev;
          dirty.delete(k);
          saveBase(k, entry.value);
          changed.push(k);
        }
      }
    }

    saveMeta(meta);
    saveRevs(revs);
    saveDirty(dirty);
    setSyncState("idle");
    if (changed.length) notifyData(changed);
    if (dirty.size) await push();
    return changed.length > 0;
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
  /** Called with the keys another device's data just replaced on this one. */
  subscribeData(fn: (keys: string[]) => void) {
    dataListeners.add(fn);
    return () => dataListeners.delete(fn);
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

/**
 * Fingerprints of everything dismissed, recomputed from the stored title and
 * company rather than read from the stored `fp`. The fingerprint rule changed
 * (it keeps the level now), and matching on the old strings would have brought
 * back every job dismissed under the old rule.
 */
function dismissedFps(): Set<string> {
  return new Set(
    read<DismissedJob[]>(KEYS.dismissed, []).map((d) =>
      d.title || d.company ? fingerprint({ title: d.title, company: d.company }) : d.fp
    )
  );
}

export const store = {
  getResume: () => read<ResumeData | null>(KEYS.resume, null),
  setResume: (r: ResumeData) => write(KEYS.resume, r),

  getProfile: () => read<Profile>(KEYS.profile, defaultProfile),
  setProfile: (p: Profile): boolean => write(KEYS.profile, p),

  getValidation: () => read<ValidationResult | null>(KEYS.validation, null),
  setValidation: (v: ValidationResult) => write(KEYS.validation, v),

  getJobs: () => read<Job[]>(KEYS.jobs, []),
  setJobs: (j: Job[]) => write(KEYS.jobs, j),

  /* ---------- Removed jobs ----------
   *
   * "I removed this job and it keeps coming back" was two bugs at once:
   * removing a prepared application only deleted the application, leaving the
   * job in the match list to be offered again; and the match list was keyed by
   * a per-search id, so even a job-level removal stopped matching as soon as
   * the next search minted a new id for the same posting. Both are fixed by
   * keeping a dismissal list keyed by fingerprint and filtering every list
   * through it. */
  getDismissed: () => read<DismissedJob[]>(KEYS.dismissed, []),

  isDismissed: (job: { title?: string; company?: string }) => dismissedFps().has(fingerprint(job)),

  dismissJob: (job: { title?: string; company?: string }) => {
    const fp = fingerprint(job);
    const list = read<DismissedJob[]>(KEYS.dismissed, []);
    if (!dismissedFps().has(fp)) {
      list.push({
        fp,
        title: job.title || "",
        company: job.company || "",
        at: Date.now(),
      });
      write(KEYS.dismissed, list);
    }
    // Drop it from the visible match list too, so it disappears immediately
    // rather than at the next search.
    const jobs = read<Job[]>(KEYS.jobs, []).filter((j) => fingerprint(j) !== fp);
    write(KEYS.jobs, jobs);
    return jobs;
  },

  undismiss: (fp: string) =>
    write(
      KEYS.dismissed,
      read<DismissedJob[]>(KEYS.dismissed, []).filter((d) => d.fp !== fp)
    ),

  clearDismissed: () => write<DismissedJob[]>(KEYS.dismissed, []),

  /**
   * Merges a fresh search into the saved matches.
   *
   * `setJobs` replaced the whole list, so every search threw away the previous
   * one — including anything already queued in Auto-Apply or Auto-Pilot, whose
   * cards then lost the job they referred to. Merging keeps the history,
   * refreshes anything re-found, and drops what the user has dismissed.
   */
  addJobs: (incoming: Job[]) => {
    const dismissed = dismissedFps();
    const merged = read<Job[]>(KEYS.jobs, []);
    const index = new Map(merged.map((j, i) => [fingerprint(j), i]));
    let added = 0;

    for (const job of incoming) {
      const fp = fingerprint(job);
      if (dismissed.has(fp)) continue;
      const at = index.get(fp);
      if (at === undefined) {
        index.set(fp, merged.length);
        merged.push({ ...job, foundAt: job.foundAt ?? Date.now() });
        added++;
      } else {
        /*
         * Re-found. Take the newer analysis, keep the original discovery date —
         * and keep whichever copy has the better origin. Without that last part
         * a later "Job portals" search would overwrite a job found on the
         * company's own Greenhouse board with Adzuna's redirect to it, quietly
         * turning a one-click direct application into a portal round-trip.
         */
        const prev = merged[at];
        const keepPrevOrigin = sourceRank(prev.source) > sourceRank(job.source);
        // A re-found job arrives with only a quick score; an AI analysis already
        // saved for it is worth more. (Jobs saved before quick scoring existed
        // have no flag and were all AI-analysed.)
        const keepAnalysis = job.aiScored === false && prev.aiScored !== false;
        const incoming: Job = keepAnalysis
          ? {
              ...prev,
              description: job.description || prev.description,
              postedAt: job.postedAt || prev.postedAt,
              url: job.url,
              source: job.source,
            }
          : job;
        merged[at] = {
          ...prev,
          ...incoming,
          foundAt: prev.foundAt ?? Date.now(),
          // The id is this app's own handle for the job: prepared applications
          // and the Auto-Pilot queue reference it, and re-keying it here would
          // orphan them and re-offer a job that is already queued.
          id: prev.id,
          ...(keepPrevOrigin ? { url: prev.url, source: prev.source } : {}),
        };
      }
    }

    write(KEYS.jobs, merged);
    return { jobs: merged, added };
  },

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
   * IMAP pagination cursor. `uid` is only meaningful for the mailbox generation
   * named by `uidValidity` — if Gmail rebuilds INBOX that number changes and the
   * stored uid must be thrown away, or we would resume from a UID belonging to
   * different mail. The page only advances this after the mail it covers has
   * been written to the inbox, so an interrupted sync resumes, never skips.
   */
  getInboxCursor: () =>
    read<InboxCursor>(KEYS.inboxCursor, { uid: 0, uidValidity: "" }),
  setInboxCursor: (c: InboxCursor) => write(KEYS.inboxCursor, c),

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
