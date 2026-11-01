import type { InboxMessage, Job, PreparedApplication, QueuedApplication, ReferralRecord, SentEmail } from "./types";
import { isVerifiedSource } from "./ats";
import { fingerprint, isBlockedListing } from "./jobFilters";

/**
 * What needs doing today, worked out from what the app already holds.
 *
 * The dashboard used to show totals, which say how much has happened and nothing
 * about what to do next, and the things that decide a job search were spread over
 * six pages: a recruiter waiting on a reply, a follow-up gone quiet, an application
 * with no answer. Pure, so it can be tested without a browser.
 */

const DAY = 86_400_000;

/** A company usually answers within this; past it, a nudge is worth sending. */
const QUIET_APPLICATION_DAYS = 14;
const QUIET_REFERRAL_DAYS = 7;
/** Applying in the first week is when an application is most likely to be read. */
const FRESH_MATCH_DAYS = 7;
const STRONG_MATCH = 75;

export interface TodayItem {
  key: string;
  count: number;
  title: string;
  detail: string;
  href: string;
  tone: "red" | "amber" | "blue" | "green";
}

export interface TodayInput {
  inbox: InboxMessage[];
  emails: SentEmail[];
  queue: QueuedApplication[];
  apps: PreparedApplication[];
  referrals: ReferralRecord[];
  jobs: Job[];
}

/** Fingerprints of every job already applied to, through either flow. */
export function appliedKeys(apps: PreparedApplication[], queue: QueuedApplication[]): Set<string> {
  const out = new Set<string>();
  for (const a of apps) {
    if (a.status === "applied") out.add(fingerprint({ title: a.jobTitle, company: a.company }));
  }
  for (const q of queue) {
    if (q.status === "submitted") out.add(fingerprint({ title: q.title, company: q.company }));
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function buildToday(d: TodayInput, now = Date.now()): TodayItem[] {
  const items: TodayItem[] = [];

  const mail = d.inbox.filter((m) => m.actionNeeded && !m.handled && m.category && m.category !== "not_job");
  if (mail.length) {
    const top = mail.find((m) => m.category === "applied_reply" || m.category === "recruiter_outreach") ?? mail[0];
    items.push({
      key: "mail",
      count: mail.length,
      title: `Reply to ${mail.length} ${plural(mail.length, "email")}`,
      detail: top.company ? `Starting with ${top.company}` : top.subject,
      href: "/inbox",
      tone: "red",
    });
  }

  const approvals = d.queue.filter((q) => q.status === "needs_approval");
  if (approvals.length) {
    items.push({
      key: "approve",
      count: approvals.length,
      title: `Approve ${approvals.length} tailored ${plural(approvals.length, "resume")}`,
      detail: "The AI needs a yes or no on claims that aren't in your resume yet",
      href: "/apply?tab=pilot",
      tone: "amber",
    });
  }

  const followUps = d.emails.filter((e) => e.followUpDue && now > e.followUpDue);
  if (followUps.length) {
    items.push({
      key: "followup",
      count: followUps.length,
      title: `Follow up on ${followUps.length} ${plural(followUps.length, "email")}`,
      detail: "Sent 5 or more days ago with no follow-up",
      href: "/outreach",
      tone: "amber",
    });
  }

  const ready = d.queue.filter((q) => q.status === "approved" || q.status === "exported");
  if (ready.length) {
    items.push({
      key: "ready",
      count: ready.length,
      title: `Submit ${ready.length} ready ${plural(ready.length, "application")}`,
      detail: "Tailored and approved. Open them and press Submit",
      href: "/apply?tab=pilot",
      tone: "green",
    });
  }

  const opened = d.queue.filter((q) => q.status === "opened");
  if (opened.length) {
    items.push({
      key: "opened",
      count: opened.length,
      title: `Did you submit ${opened.length} opened ${plural(opened.length, "application")}?`,
      detail: "Mark them submitted so replies get counted",
      href: "/apply?tab=pilot",
      tone: "blue",
    });
  }

  // Both flows, with the date it went out. An application with a later stage
  // recorded has already had an answer.
  const quietSince = now - QUIET_APPLICATION_DAYS * DAY;
  const quiet = [
    ...d.apps.filter((a) => a.outcome === "applied" && (a.outcomeAt ?? a.at) < quietSince),
    ...d.queue.filter((q) => q.outcome === "applied" && (q.outcomeAt ?? q.at) < quietSince),
  ];
  if (quiet.length) {
    items.push({
      key: "quiet",
      count: quiet.length,
      title: `${quiet.length} ${plural(quiet.length, "application")} quiet for ${QUIET_APPLICATION_DAYS}+ days`,
      detail: "Ask for a referral there, or mark them ghosted so the funnel stays true",
      href: "/apply?tab=kits",
      tone: "blue",
    });
  }

  const asked = d.referrals.filter(
    (r) => (r.stage === "asked" || r.stage === "accepted") && now - r.updatedAt > QUIET_REFERRAL_DAYS * DAY
  );
  if (asked.length) {
    items.push({
      key: "referrals",
      count: asked.length,
      title: `Nudge ${asked.length} referral ${plural(asked.length, "ask")}`,
      detail: `No change for ${QUIET_REFERRAL_DAYS}+ days`,
      href: "/referrals",
      tone: "amber",
    });
  }

  const applied = appliedKeys(d.apps, d.queue);
  const inPipeline = new Set([...d.apps.map((a) => a.jobId), ...d.queue.map((q) => q.jobId)]);
  const fresh = d.jobs.filter(
    (j) =>
      j.aiScored !== false &&
      j.matchScore >= STRONG_MATCH &&
      isVerifiedSource(j.source) &&
      !isBlockedListing(j.url, j.company) &&
      !inPipeline.has(j.id) &&
      !applied.has(fingerprint(j)) &&
      now - new Date(j.postedAt || j.foundAt || 0).getTime() <= FRESH_MATCH_DAYS * DAY
  );
  if (fresh.length) {
    const best = fresh.reduce((a, b) => (b.matchScore > a.matchScore ? b : a));
    items.push({
      key: "fresh",
      count: fresh.length,
      title: `${fresh.length} strong ${plural(fresh.length, "match", "matches")} this week`,
      detail: `Best: ${best.title} at ${best.company} (${best.matchScore}%)`,
      href: "/jobs",
      tone: "green",
    });
  }

  return items;
}
