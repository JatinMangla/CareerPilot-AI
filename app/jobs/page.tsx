"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import { mapPool, AI_CONCURRENCY } from "@/lib/pool";
import { quota } from "@/lib/quota";
import { isVerifiedSource } from "@/lib/ats";
import { isBlockedListing } from "@/lib/jobFilters";
import { roleSuggestions, searchVariants } from "@/lib/roleSuggestions";
import type { Job } from "@/lib/types";

type Focus = "boards" | "yc" | "portals" | "all";

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

/** Listings analyzed per AI call. Small batches keep each answer within budget. */
const BATCH = 8;

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
        .sort((a, b) => b.matchScore - a.matchScore),
    [jobs, focus]
  );

  const counts = useMemo(() => {
    const c = {} as Record<Focus, number>;
    for (const f of FILTERS) c[f.k] = jobs.filter((j) => BUCKETS[f.k](j.source)).length;
    return c;
  }, [jobs]);

  async function findJobs() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — matching needs it.");
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const profile = store.getProfile();
      const apiFocus = focus === "all" ? "all" : focus;
      setStatus(
        focus === "portals"
          ? "Searching job portals (Google for Jobs + Adzuna)…"
          : "Reading company career boards (Greenhouse / Lever / Ashby)…"
      );

      const live = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          location,
          focus: apiFocus,
          limit: depth,
          // Extra phrasings from the profile — feeds are literal, so
          // "React Developer" and "Frontend Engineer" find different jobs.
          queries: searchVariants(query, profile),
        }),
      }).then((r) => r.json());

      let analyzed: Job[] = [];

      if (live.available && live.listings?.length) {
        // Company boards are free public JSON — only metered aggregators count.
        if (live.counts?.jsearch || live.counts?.adzuna) quota.bump("jobsApi");

        const listings: any[] = live.listings;
        const batches: any[][] = [];
        for (let i = 0; i < listings.length; i += BATCH) {
          batches.push(listings.slice(i, i + BATCH));
        }

        setStatus(
          `Found ${listings.length} live listings — scoring them against your resume ` +
            `(${batches.length} batch${batches.length === 1 ? "" : "es"})…`
        );

        /*
         * One call for the whole search would have to fit every listing AND
         * every analysis inside a single response budget, which is what capped
         * the old flow at ten jobs. Batching lets the search return as many
         * jobs as the sources have, and the batches overlap so it is not
         * proportionally slower. A failed batch loses eight jobs, not all of them.
         */
        const outcomes = await mapPool(
          batches,
          AI_CONCURRENCY,
          (batch) =>
            jsonTask<{ jobs: Job[] }>("analyze_jobs", {
              jobs: batch,
              resume: resume.text,
              profile,
            }),
          (done, total) =>
            setStatus(`Scoring ${listings.length} listings against your resume… ${done}/${total} batches`)
        );

        /*
         * Trust the model for the analysis, never for the facts. It is asked to
         * echo id/url/source back unchanged, and mostly does — but a single
         * rewritten URL here becomes an application sent to a link that does not
         * exist, and a rewritten source would let an AI guess pass isVerifiedSource.
         * Re-stamp them from the listing the batch was built from.
         */
        for (const o of outcomes) {
          if (!o.value?.jobs) continue;
          const batch = o.item;
          o.value.jobs.forEach((scored, i) => {
            const src = batch.find((b: any) => b.id === scored.id) || batch[i];
            if (!src) return;
            analyzed.push({
              ...scored,
              id: src.id,
              title: src.title,
              company: src.company,
              location: src.location || scored.location,
              url: src.url,
              source: src.source,
              description: scored.description || src.description,
            });
          });
        }

        const failed = outcomes.filter((o) => o.error);
        if (failed.length) {
          setNotice(
            `${failed.length} of ${batches.length} batches could not be scored ` +
              `(${failed[0].error!.message}). The rest are below — run the search again for those.`
          );
        }
      } else {
        setStatus("No live listings matched — asking the AI to research openings instead…");
        const result = await jsonTask<{ jobs: Job[] }>("find_jobs", {
          resume: resume.text,
          profile,
          count: 12,
          focus: focus === "yc" ? "yc" : "all",
        });
        // Force the source: isVerifiedSource is what stops an invented listing
        // reaching the apply pipeline, so it must not depend on the model
        // remembering to label its own guesses.
        analyzed = (result.jobs || []).map((j) => ({ ...j, source: "ai-researched" }));
      }

      if (!analyzed.length) {
        setError(
          "No matches came back. Try a broader role (e.g. \"software engineer\"), " +
            "a wider location (\"India\" or \"Remote\"), or the Everything filter."
        );
        return;
      }

      // AI leads belong to no source filter, so land the user on the one that
      // shows them rather than on an empty "Company boards" list.
      if (analyzed[0]?.source === "ai-researched") setFocus("all");

      const { jobs: merged, added } = store.addJobs(analyzed);
      store.bumpStat("jobsAnalyzed", analyzed.length);
      setJobs(merged);
      setNotice((n) =>
        [
          `${added} new job${added === 1 ? "" : "s"} added (${analyzed.length} analyzed, ` +
            `duplicates and removed jobs filtered out).`,
          n,
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
                  {activeFilter.label}, scored by AI against your resume.
                  {unverified > 0 && ` ${unverified} AI-researched lead(s) mixed in.`}
                </span>
                <span className="ml-auto flex gap-3">
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
            {visible.map((job) => (
              <JobCard key={job.id} job={job} onDismiss={() => dismiss(job)} />
            ))}
          </div>

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
  const scoreTone =
    job.matchScore >= 75 ? "badge-green" : job.matchScore >= 55 ? "badge-amber" : "badge-red";

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
          <span className={scoreTone}>{job.matchScore}% match</span>
          {job.salary && <span className="badge-blue">{job.salary}</span>}
        </div>
      </div>

      <p className="text-xs text-ink-400 mt-2">{job.recommendation}</p>

      <div className="flex items-center gap-4 mt-3">
        <button className="text-xs text-neon-400 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Hide analysis ▲" : "Full analysis ▼"}
        </button>
        {job.url && (
          <a
            href={job.url}
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
