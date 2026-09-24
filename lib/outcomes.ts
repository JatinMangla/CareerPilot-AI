"use client";

import { store } from "./store";
import { fingerprint } from "./jobFilters";
import type { OutcomeStage, PreparedApplication, QueuedApplication } from "./types";

/**
 * What happened to every application, wherever it was made.
 *
 * Applications live in two lists — Apply Kits (cp_apps) and Auto-Pilot
 * (cp_queue) — and the funnel used to read only the first, so everything sent
 * through Auto-Pilot was invisible to it. And it only counted: nothing said
 * which channel, which resume version or which kind of match actually produced
 * replies, so "Evolve" tuned the strategy on general research instead of on
 * this candidate's own results. This joins the two and breaks results down.
 */

export interface TrackedApplication {
  kind: "app" | "queue";
  jobId: string;
  company: string;
  title: string;
  channel: string;
  outcome: OutcomeStage;
  appliedAt: number;
  outcomeAt?: number;
  matchScore?: number;
  resumeVersion?: number;
}

/** A readable channel from a job's source. */
export function channelOf(source: string | undefined): string {
  if (source === "company-boards" || source === "yc-boards") return "Company board";
  if (source === "jsearch" || source === "adzuna") return "Job portal";
  if (source === "ai-researched") return "AI lead";
  return "Other";
}

export function trackedApplications(): TrackedApplication[] {
  const out: TrackedApplication[] = [];
  const seen = new Set<string>();
  for (const a of store.getApps()) {
    if (!a.outcome) continue;
    seen.add(a.jobId);
    out.push({
      kind: "app",
      jobId: a.jobId,
      company: a.company,
      title: a.jobTitle,
      channel: channelOf(a.source),
      outcome: a.outcome,
      appliedAt: a.at,
      outcomeAt: a.outcomeAt,
      matchScore: a.matchScore,
      resumeVersion: a.resumeVersion,
    });
  }
  for (const q of store.getQueue()) {
    if (!q.outcome || seen.has(q.jobId)) continue;
    out.push({
      kind: "queue",
      jobId: q.jobId,
      company: q.company,
      title: q.title,
      channel: channelOf(q.source),
      outcome: q.outcome,
      appliedAt: q.at,
      outcomeAt: q.outcomeAt,
      matchScore: q.matchScore,
      resumeVersion: q.resumeVersion,
    });
  }
  return out;
}

const REPLIED: OutcomeStage[] = ["replied", "screen", "interview", "offer"];

export interface Funnel {
  applied: number;
  replied: number;
  screen: number;
  interview: number;
  offer: number;
  rejected: number;
  replyRate: number;
  interviewRate: number;
}

/** Anything past "applied" counts toward the stages before it, so it reads as a funnel. */
export function funnelOf(list: TrackedApplication[]): Funnel {
  const has = (...s: OutcomeStage[]) => list.filter((a) => s.includes(a.outcome)).length;
  const applied = list.length;
  const replied = has(...REPLIED);
  const interview = has("interview", "offer");
  return {
    applied,
    replied,
    screen: has("screen", "interview", "offer"),
    interview,
    offer: has("offer"),
    rejected: has("rejected", "ghosted"),
    replyRate: applied ? (replied / applied) * 100 : 0,
    interviewRate: applied ? (interview / applied) * 100 : 0,
  };
}

export interface BreakdownRow {
  label: string;
  applied: number;
  replied: number;
  interviews: number;
  replyRate: number;
}

/** Results per group — the comparison that says what is working. */
export function breakdown(
  list: TrackedApplication[],
  groupOf: (a: TrackedApplication) => string
): BreakdownRow[] {
  const groups = new Map<string, TrackedApplication[]>();
  for (const a of list) {
    const k = groupOf(a);
    groups.set(k, [...(groups.get(k) || []), a]);
  }
  return Array.from(groups, ([label, items]) => {
    const f = funnelOf(items);
    return {
      label,
      applied: f.applied,
      replied: f.replied,
      interviews: f.interview,
      replyRate: f.replyRate,
    };
  }).sort((a, b) => b.applied - a.applied);
}

export function scoreBand(a: TrackedApplication): string {
  if (typeof a.matchScore !== "number") return "Unscored";
  if (a.matchScore >= 80) return "Match 80+";
  if (a.matchScore >= 60) return "Match 60-79";
  return "Match under 60";
}

export function resumeLabel(a: TrackedApplication): string {
  return a.resumeVersion
    ? `Resume of ${new Date(a.resumeVersion).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
    : "Resume version not recorded";
}

/** Median days from applying to the first reply, over applications that got one. */
export function medianDaysToReply(list: TrackedApplication[]): number | null {
  const days = list
    .filter((a) => REPLIED.includes(a.outcome) && a.outcomeAt && a.outcomeAt > a.appliedAt)
    .map((a) => (a.outcomeAt! - a.appliedAt) / 86_400_000)
    .sort((x, y) => x - y);
  if (!days.length) return null;
  return Math.round(days[Math.floor(days.length / 2)] * 10) / 10;
}

/** The evidence "Evolve" revises the strategy on. */
export function outcomeSnapshot() {
  const list = trackedApplications();
  const referrals = store.getReferrals();
  return {
    applicationsPrepared: store.getApps().length + store.getQueue().length,
    ...funnelOf(list),
    byChannel: breakdown(list, (a) => a.channel),
    byMatchScore: breakdown(list, scoreBand),
    byResumeVersion: breakdown(list, resumeLabel),
    medianDaysToFirstReply: medianDaysToReply(list),
    referralAsksSent: referrals.filter((r) => r.stage !== "planned").length,
    referralsSecured: referrals.filter((r) => r.stage === "referred").length,
  };
}

/** Facts to stamp on an application at the moment it is sent. */
export function applicationStamp(job: { source?: string; matchScore?: number } | undefined) {
  return {
    source: job?.source,
    matchScore: job?.matchScore,
    resumeVersion: store.getResume()?.updatedAt,
  };
}

/** Applications to a company, for matching an employer's reply to what was sent. */
export function applicationsAt(company: string): TrackedApplication[] {
  const key = fingerprint({ company, title: "" });
  return trackedApplications().filter((a) => fingerprint({ company: a.company, title: "" }) === key);
}

/** Records a new stage for an application, whichever list it lives in. */
export function recordOutcome(target: Pick<TrackedApplication, "kind" | "jobId">, outcome: OutcomeStage) {
  const now = Date.now();
  if (target.kind === "app") {
    store.setApps(
      store
        .getApps()
        .map((a: PreparedApplication) =>
          a.jobId === target.jobId ? { ...a, outcome, outcomeAt: now } : a
        )
    );
  } else {
    store.setQueue(
      store
        .getQueue()
        .map((q: QueuedApplication) =>
          q.jobId === target.jobId ? { ...q, outcome, outcomeAt: now } : q
        )
    );
  }
}
