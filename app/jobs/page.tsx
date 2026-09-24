"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import { mapPool, AI_CONCURRENCY } from "@/lib/pool";
import { quota } from "@/lib/quota";
import { isVerifiedSource } from "@/lib/ats";
import { isBlockedListing } from "@/lib/jobFilters";
import { safeHref } from "@/lib/safeUrl";
import { roleSuggestions, searchVariants } from "@/lib/roleSuggestions";
import { Pager, usePaged } from "@/components/Pager";
import { quickScore } from "@/lib/jobScore";
import type { Job, Profile } from "@/lib/types";

type Focus = "boards" | "yc" | "portals" | "all";

const PAGE_SIZE = 15;

/**
 * Which listing sources belong to each filter.
 *
 * The filters used to be a search setting only — clicking one changed what the
 * NEXT search would ask for, while the list on screen stayed exactly as it was.
 * That is why every filter appeared to show the same jobs. Each filter now owns
 * the sources it produced, so switching filters switches the list immediately.
 */
const BUCKETS: Record<Focus, (source: string) => boolean> = {
  boards: (s) => s === "company-boards",
  yc: (s) => s === "yc-boards",
  portals: (s) => s === "jsearch" || s === "adzuna",
  all: () => true,
};

const FILTERS: { k: Focus; label: string; hint: string }[] = [
  {
    k: "boards",
    label: "🏢 Company boards",
    hint: "120 company career boards (Greenhouse / Lever / Ashby) — first-party, always current, and auto-applyable.",
  },
  {
    k: "yc",
    label: "🟠 Y Combinator",
    hint: "Only the YC-backed companies from those boards — smaller teams, faster processes, founders often read applications themselves.",
  },
  {
    k: "portals",
    label: "🌐 Job portals",
    hint: "Google for Jobs + Adzuna (LinkedIn / Indeed / Glassdoor postings). Widest reach, but you submit these ones by hand.",
  },
  { k: "all", label: "📋 Everything", hint: "Every job found so far, from all sources." },
];

/**
 * Listings per AI call. The model now returns only its judgement, keyed by id —
 * it used to echo every listing back — so a batch of 20 fits where 8 used to.
 */
const BATCH = 20;

/**
 * How many of the best quick-scored listings the AI analyses on its own. The
 * rest keep their quick score and are one click away ("Analyze more"), so a big
 * search costs 2 calls up front instead of ~19, and nothing is silently dropped.
 */
const AUTO_ANALYZE = 40;

interface AnalysisRow {
  id: string;
  salary: string;
  matchScore: number;
  pros: string[];
  cons: string[];
  jobSecurity: string;
  futureOutlook: string;
  recommendation: string;
}

/** A listing with its instant, no-AI score (lib/jobScore.ts). */
function toQuickJob(l: any, profile: Profile): Job {
  const q = quickScore(l, profile);
  return {
    id: l.id,
    title: l.title,
    company: l.company,
    location: l.location || "",
    salary: l.salary || "",
    url: l.url,
    source: l.source,
    description: l.description || "",
    postedAt: l.postedAt,
    matchScore: q.score,
    pros: q.pros,
    cons: q.cons,
    jobSecurity: "",
    futureOutlook: "",
    recommendation: "Quick score from skills and experience overlap — not analysed by AI yet.",
    aiScored: false,
  };
}

/**
 * AI analysis for some jobs. Facts (id, title, company, URL, source) always come
 * from the listing, never from the model: a rewritten URL would send an
 * application to a link that does not exist, and a rewritten source would let an
 * AI guess pass isVerifiedSource. An answer whose id matches nothing in its batch
 * is dropped — the old positional fallback could pin one job's analysis onto
 * another job's link.
 */
async function analyzeJobs(
  targets: Job[],
  resumeText: string,
  profile: Profile,
  onProgress: (done: number, total: number) => void
): Promise<{ analyzed: Job[]; failed: number; batches: number; firstError: string }> {
  const batches: Job[][] = [];
  for (let i = 0; i < targets.length; i += BATCH) batches.push(targets.slice(i, i + BATCH));

  const outcomes = await mapPool(
    batches,
    AI_CONCURRENCY,
    (batch) =>
      jsonTask<{ jobs: AnalysisRow[] }>("analyze_jobs", {
        jobs: batch.map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
          location: j.location,
          salary: j.salary,
          postedAt: j.postedAt,
          description: j.description,
        })),
        resume: resumeText,
        profile,
      }),
    onProgress
  );

  const analyzed: Job[] = [];
  for (const o of outcomes) {
    for (const row of o.value?.jobs || []) {
      const src = o.item.find((b) => b.id === row.id);
      if (!src) continue;
      analyzed.push({
        ...src,
        salary: src.salary || row.salary || "",
        matchScore: row.matchScore,
        pros: row.pros || [],
        cons: row.cons || [],
        jobSecurity: row.jobSecurity || "",
        futureOutlook: row.futureOutlook || "",
        recommendation: row.recommendation || "",
        aiScored: true,
      });
    }
  }
  const failedOutcomes = outcomes.filter((o) => o.error);
  return {
    analyzed,
    failed: failedOutcomes.length,
    batches: batches.length,
    firstError: failedOutcomes[0]?.error?.message || "",
  };
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("react frontend developer");
  const [location, setLocation] = useState("India");
  const [focus, setFocus] = useState<Focus>("boards");
  const [depth, setDepth] = useState(60);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hasResume, setHasResume] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [dismissedCount, setDismissedCount] = useState(0);
  const [offerAiLeads, setOfferAiLeads] = useState(false);

  useEffect(() => {
    const profile = store.getProfile();
    setJobs(store.getJobs());
    setHasResume(!!store.getResume()?.text);
    setSuggestions(roleSuggestions(profile));
    setDismissedCount(store.getDismissed().length);
    if (profile.desiredRoles) setQuery(profile.desiredRoles.split(/[,/|]/)[0].trim());
  }, []);

  const visible = useMemo(
    () =>
      jobs
        .filter((j) => BUCKETS[focus](j.source))
        .filter((j) => !isBlockedListing(j.url, j.company))
        .slice()
        // AI-analysed first — the quick score is a different, rougher scale —
        // then by score within each group.
        .sort(
          (a, b) =>
            Number(b.aiScored !== false) - Number(a.aiScored !== false) ||
            b.matchScore - a.matchScore
        ),
    [jobs, focus]
  );

  const { page, pageCount, pageItems, setPage } = usePaged(visible, PAGE_SIZE, focus);

  const counts = useMemo(() => {
    const c = {} as Record<Focus, number>;
    for (const f of FILTERS) c[f.k] = jobs.filter((j) => BUCKETS[f.k](j.source)).length;
    return c;
  }, [jobs]);

  const awaitingAnalysis = useMemo(
    () => visible.filter((j) => j.aiScored === false && isVerifiedSource(j.source)),
    [visible]
  );

  async function findJobs() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — matching needs it.");
    setError("");
    setNotice("");
    setOfferAiLeads(false);
    setBusy(true);
    try {
      const profile = store.getProfile();
      setStatus(
        focus === "portals"
          ? "Searching job portals (Google for Jobs + Adzuna)…"
          : "Reading company career boards (Greenhouse / Lever / Ashby)…"
      );

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          location,
          focus,
          limit: depth,
          yearsExperience: profile.yearsExperience,
          // Extra phrasings from the profile — feeds are literal, so
          // "React Developer" and "Frontend Engineer" find different jobs.
          queries: searchVariants(query, profile),
        }),
      });
      const live = await res.json().catch(() => ({}));

      // A failed search is reported as one. It used to fall through to the AI
      // "research" task, which spent quota inventing leads to cover an error.
      if (!res.ok) {
        setError(live.error || `Job search failed (${res.status}). Try again in a moment.`);
        return;
      }
      if (!live.available || !live.listings?.length) {
        setError(
          "No live listings matched. Try a broader role (e.g. \"software engineer\"), " +
            "a wider location (\"India\" or \"Remote\"), or the Everything filter."
        );
        setOfferAiLeads(true);
        return;
      }

      // Company boards are free public JSON — only metered aggregators count.
      if (live.counts?.jsearch || live.counts?.adzuna) quota.bump("jobsApi");

      const quick = (live.listings as any[])
        .map((l) => toQuickJob(l, profile))
        .sort((a, b) => b.matchScore - a.matchScore);
      const top = quick.slice(0, AUTO_ANALYZE);
      setStatus(
        `Found ${quick.length} live listings — AI is analysing the best ${top.length} against your resume…`
      );

      const result = await analyzeJobs(top, resume.text, profile, (done, total) =>
        setStatus(`Analysing the best ${top.length} of ${quick.length} listings… ${done}/${total} batches`)
      );
      const byId = new Map(result.analyzed.map((j) => [j.id, j]));
      const all = quick.map((j) => byId.get(j.id) ?? j);

      const { jobs: merged, added } = store.addJobs(all);
      store.bumpStat("jobsAnalyzed", result.analyzed.length);
      setJobs(merged);

      const rest = quick.length - result.analyzed.length;
      setNotice(
        [
          `${added} new job${added === 1 ? "" : "s"} added. ${result.analyzed.length} analysed by AI` +
            (rest > 0 ? `; ${rest} more carry a quick score — "Analyze more" runs the AI on them.` : "."),
          result.failed
            ? `${result.failed} of ${result.batches} AI batches failed (${result.firstError}); those jobs keep their quick score.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  /** Runs the AI over the next quick-scored jobs in this filter. */
  async function analyzeMore() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — matching needs it.");
    const targets = awaitingAnalysis.slice(0, AUTO_ANALYZE);
    if (!targets.length) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await analyzeJobs(targets, resume.text, store.getProfile(), (done, total) =>
        setStatus(`Analysing ${targets.length} more… ${done}/${total} batches`)
      );
      const { jobs: merged } = store.addJobs(result.analyzed);
      store.bumpStat("jobsAnalyzed", result.analyzed.length);
      setJobs(merged);
      setNotice(
        `${result.analyzed.length} more analysed.` +
          (result.failed ? ` ${result.failed} batch(es) failed: ${result.firstError}` : "")
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  /**
   * AI-researched leads, on request only. They are guesses — the company is
   * usually real, the role and link may not be — so they are never the silent
   * answer to an empty or failed search.
   */
  async function researchLeads() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — matching needs it.");
    setError("");
    setOfferAiLeads(false);
    setBusy(true);
    setStatus("Asking the AI to research likely openings…");
    try {
      const result = await jsonTask<{ jobs: Job[] }>("find_jobs", {
        resume: resume.text,
        profile: store.getProfile(),
        count: 12,
        focus: focus === "yc" ? "yc" : "all",
      });
      // Force the source: isVerifiedSource is what stops an invented listing
      // reaching the apply pipeline, so it must not depend on the model
      // remembering to label its own guesses.
      const leads = (result.jobs || []).map((j) => ({
        ...j,
        source: "ai-researched",
        aiScored: true,
      }));
      const { jobs: merged, added } = store.addJobs(leads);
      setJobs(merged);
      setFocus("all");
      setNotice(`${added} AI-researched lead${added === 1 ? "" : "s"} added — verify each before applying.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  function dismiss(job: Job) {
    setJobs(store.dismissJob(job));
    setDismissedCount(store.getDismissed().length);
  }

  function restoreDismissed() {
    store.clearDismissed();
    setDismissedCount(0);
    setNotice("Removed jobs restored — they can be found again on the next search.");
  }

  function clearAll() {
    if (!window.confirm("Clear every job from your match list? Prepared applications are kept."))
      return;
    store.setJobs([]);
    setJobs([]);
  }

  const activeFilter = FILTERS.find((f) => f.k === focus)!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Job Matches</h1>
        <p className="muted mt-1">
          Open roles matched to your resume — with honest pros, cons, salary, security
          and career-outlook analysis for each.
        </p>
      </div>

      <div className="card-pad flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Role / keywords</label>
          <input
            className="input"
            list="role-suggestions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing, or pick a suggestion from your profile"
          />
          {/* Suggestions come from your profile: desired roles, current title, and
              your strongest skills as job-title phrasings. */}
          <datalist id="role-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {suggestions.slice(0, 6).map((s) => (
              <button
                key={s}
                onClick={() => setQuery(s)}
                className={`rounded-full px-2.5 py-1 text-[11px] border transition ${
                  query.toLowerCase() === s.toLowerCase()
                    ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                    : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="label">Location</label>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="min-w-[120px]">
          <label className="label">How many</label>
          <select
            className="input"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          >
            <option value={25}>Up to 25</option>
            <option value={60}>Up to 60</option>
            <option value={100}>Up to 100</option>
            <option value={150}>Up to 150 (slow)</option>
          </select>
        </div>
        <button className="btn-primary" onClick={findJobs} disabled={busy || !hasResume}>
          {busy ? "Matching…" : "◎ Find my matches"}
        </button>

        <div className="w-full flex items-center gap-2 pt-1 flex-wrap">
          <span className="text-xs text-ink-400">Source:</span>
          {FILTERS.map((o) => (
            <button
              key={o.k}
              onClick={() => setFocus(o.k)}
              title={o.hint}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition ${
                focus === o.k
                  ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                  : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
              }`}
            >
              {o.label}
              {counts[o.k] > 0 && (
                <span className="ml-1.5 opacity-70">{counts[o.k]}</span>
              )}
            </button>
          ))}
        </div>
        <p className="w-full text-[11px] text-ink-400 -mt-1">{activeFilter.hint}</p>
      </div>

      {focus !== "portals" && (
        <div className="text-xs text-ink-300 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3 leading-relaxed">
          <b className="text-neon-400">
            {focus === "yc" ? "Y Combinator companies." : "Company career boards."}
          </b>{" "}
          Read straight from each company&apos;s own Greenhouse / Lever / Ashby board —
          first-party listings, always current, and no account needed. These apply links
          are exactly what{" "}
          <Link href="/autopilot" className="underline">
            Auto-Pilot
          </Link>{" "}
          can prepare and open for you.
          {focus === "yc" && (
            <>
              {" "}
              YC&apos;s own board (
              <a
                href="https://www.workatastartup.com/jobs"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Work at a Startup
              </a>
              ) needs a free account and a note the founder reads personally — worth doing
              by hand.
            </>
          )}
        </div>
      )}

      {!hasResume && (
        <div className="card-pad text-sm text-ink-300">
          <Link href="/resume" className="text-neon-400 underline">
            Add your resume
          </Link>{" "}
          to enable matching.
        </div>
      )}
      {status && <div className="card-pad text-sm text-ink-300 animate-pulse">{status}</div>}
      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
          {offerAiLeads && (
            <div className="mt-2 text-xs text-ink-300">
              Or{" "}
              <button className="underline text-neon-400" onClick={researchLeads} disabled={busy}>
                ask the AI to suggest likely openings
              </button>{" "}
              — guesses to verify by hand, not live listings.
            </div>
          )}
        </div>
      )}
      {notice && !busy && (
        <div className="text-xs text-sky2-400 bg-sky2-500/10 border border-sky2-500/25 rounded-xl px-4 py-3">
          {notice}
        </div>
      )}

      {jobs.length > 0 && (
        <>
          {(() => {
            const unverified = visible.filter((j) => !isVerifiedSource(j.source)).length;
            if (!visible.length) {
              return (
                <div className="card-pad text-sm text-ink-300">
                  Nothing in <b className="text-ink-100">{activeFilter.label}</b> yet — press
                  “Find my matches” with this filter selected and it fills up with its own
                  listings. Other filters keep their results separately.
                </div>
              );
            }
            if (unverified === visible.length) {
              return (
                <div className="text-xs text-amberx-400 bg-amberx-500/10 border border-amberx-500/25 rounded-xl px-4 py-3 leading-relaxed">
                  ⚠ These are <b>AI-researched leads</b>, not verified listings — the company
                  may be real but the role and link may not be. Verify each one before
                  applying; Auto-Pilot won&apos;t prepare them.
                </div>
              );
            }
            return (
              <div className="text-xs text-neon-400 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3 leading-relaxed flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>
                  ✓ Showing {visible.length} listing{visible.length === 1 ? "" : "s"} in{" "}
                  {activeFilter.label}.{" "}
                  {awaitingAnalysis.length > 0
                    ? `${visible.length - awaitingAnalysis.length} analysed by AI; ${awaitingAnalysis.length} have a quick score.`
                    : "All analysed by AI against your resume."}
                  {unverified > 0 && ` ${unverified} AI-researched lead(s) mixed in.`}
                </span>
                <span className="ml-auto flex gap-3">
                  {awaitingAnalysis.length > 0 && (
                    <button
                      className="underline hover:text-neon-300 font-semibold"
                      onClick={analyzeMore}
                      disabled={busy}
                    >
                      Analyze {Math.min(AUTO_ANALYZE, awaitingAnalysis.length)} more with AI
                    </button>
                  )}
                  {dismissedCount > 0 && (
                    <button className="underline hover:text-neon-300" onClick={restoreDismissed}>
                      Restore {dismissedCount} removed
                    </button>
                  )}
                  <button className="underline hover:text-coral-400" onClick={clearAll}>
                    Clear list
                  </button>
                </span>
              </div>
            );
          })()}

          <div className="grid gap-4">
            {pageItems.map((job) => (
              <JobCard key={job.id} job={job} onDismiss={() => dismiss(job)} />
            ))}
          </div>

          <Pager
            page={page}
            pageCount={pageCount}
            total={visible.length}
            unit="matches"
            onPage={setPage}
          />

          {visible.length > 0 && (
            <div className="card-pad flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-ink-300">
                Ready to apply? Auto-Pilot tailors your resume per job and opens each
                application for you; Auto-Apply builds a cover letter + screening answers.
              </p>
              <div className="flex gap-2">
                <Link href="/autopilot" className="btn-primary">
                  ✦ Auto-Pilot
                </Link>
                <Link href="/auto-apply" className="btn-secondary">
                  ➤ Auto-Apply
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  "company-boards": "Company board",
  "yc-boards": "YC company",
  jsearch: "Google for Jobs",
  adzuna: "Adzuna",
  "ai-researched": "AI lead",
};

function JobCard({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const quick = job.aiScored === false;
  const scoreTone = quick
    ? "badge-blue"
    : job.matchScore >= 75
    ? "badge-green"
    : job.matchScore >= 55
    ? "badge-amber"
    : "badge-red";

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display font-bold text-base text-ink-100">{job.title}</h3>
          <p className="text-sm text-ink-300 mt-0.5">
            {job.company} · {job.location}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-blue text-[10px]">
            {SOURCE_LABELS[job.source] || job.source}
          </span>
          <span
            className={scoreTone}
            title={
              quick
                ? "Quick score from skills, experience and freshness — no AI yet. Use “Analyze more” for a full read."
                : "AI match score against your resume"
            }
          >
            {quick ? `~${job.matchScore} quick score` : `${job.matchScore}% match`}
          </span>
          {job.salary && <span className="badge-blue">{job.salary}</span>}
        </div>
      </div>

      <p className="text-xs text-ink-400 mt-2">{job.recommendation}</p>

      <div className="flex items-center gap-4 mt-3">
        <button className="text-xs text-neon-400 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Hide analysis ▲" : "Full analysis ▼"}
        </button>
        {safeHref(job.url) && (
          <a
            href={safeHref(job.url)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-ink-400 hover:text-ink-200"
          >
            Open listing ↗
          </a>
        )}
        {/* Removing here is permanent: the job is remembered by company + title,
            so it stays gone even though the next search gives it a new id. */}
        <button className="text-xs text-coral-400 hover:underline ml-auto" onClick={onDismiss}>
          Not interested
        </button>
      </div>

      {open && (
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-neon-400 mb-2">
              Pros
            </h4>
            <ul className="space-y-1.5">
              {job.pros.map((p, i) => (
                <li key={i} className="text-xs text-ink-300 flex gap-2">
                  <span className="text-neon-400">+</span> {p}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-coral-400 mb-2">
              Cons
            </h4>
            <ul className="space-y-1.5">
              {job.cons.map((c, i) => (
                <li key={i} className="text-xs text-ink-300 flex gap-2">
                  <span className="text-coral-400">−</span> {c}
                </li>
              ))}
            </ul>
          </div>
          {(job.jobSecurity || job.futureOutlook) && (
            <div className="md:col-span-2 grid sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-ink-850 p-3">
                <span className="font-bold text-ink-100">Job security: </span>
                <span className="text-ink-300">{job.jobSecurity}</span>
              </div>
              <div className="rounded-xl bg-ink-850 p-3">
                <span className="font-bold text-ink-100">Future outlook: </span>
                <span className="text-ink-300">{job.futureOutlook}</span>
              </div>
            </div>
          )}
          {job.description && (
            <p className="md:col-span-2 text-xs text-ink-400 leading-relaxed">
              {job.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
