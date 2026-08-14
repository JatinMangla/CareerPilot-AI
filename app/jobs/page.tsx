"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import { quota } from "@/lib/quota";
import { isVerifiedSource } from "@/lib/ats";
import type { Job } from "@/lib/types";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("react frontend developer");
  const [location, setLocation] = useState("India");
  const [focus, setFocus] = useState<"all" | "boards" | "yc">("boards");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [hasResume, setHasResume] = useState(true);

  useEffect(() => {
    setJobs(store.getJobs());
    setHasResume(!!store.getResume()?.text);
  }, []);

  async function findJobs() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — matching needs it.");
    setError("");
    setBusy(true);
    try {
      setStatus(
        focus === "all"
          ? "Checking live job APIs…"
          : "Reading company career boards (Greenhouse / Lever / Ashby)…"
      );
      const live = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location, focus }),
      }).then((r) => r.json());

      let result: { jobs: Job[] };
      if (live.available && live.listings?.length) {
        // Company boards are free public JSON — only metered aggregators count.
        if (live.source === "jsearch" || live.source === "adzuna") quota.bump("jobsApi");
        setStatus(
          `Analyzing ${live.listings.length} live listings (${live.source}) against your resume…`
        );
        result = await jsonTask<{ jobs: Job[] }>("analyze_jobs", {
          jobs: live.listings,
          resume: resume.text,
        });
      } else {
        setStatus(
          focus === "yc"
            ? "Researching Y Combinator startups hiring for your profile…"
            : "Live API not configured — AI is researching matching openings…"
        );
        result = await jsonTask<{ jobs: Job[] }>("find_jobs", {
          resume: resume.text,
          profile: store.getProfile(),
          count: 8,
          focus,
        });
      }
      store.setJobs(result.jobs);
      store.bumpStat("jobsAnalyzed", result.jobs.length);
      setJobs(result.jobs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

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
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="label">Location</label>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={findJobs} disabled={busy || !hasResume}>
          {busy ? "Matching…" : "◎ Find my matches"}
        </button>
        <div className="w-full flex items-center gap-2 pt-1">
          <span className="text-xs text-ink-400">Source:</span>
          {([
            { k: "boards", label: "🏢 Company boards (live)" },
            { k: "yc", label: "🟠 Y Combinator" },
            { k: "all", label: "🌐 All job sites" },
          ] as const).map((o) => (
            <button
              key={o.k}
              onClick={() => setFocus(o.k)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition ${
                focus === o.k
                  ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                  : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {focus !== "all" && (
        <div className="text-xs text-ink-300 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3 leading-relaxed">
          <b className="text-neon-400">
            {focus === "yc" ? "Y Combinator companies." : "Company career boards."}
          </b>{" "}
          Read straight from each company&apos;s own Greenhouse / Lever / Ashby board —
          first-party listings, always current, and no account needed. Best of all, these
          apply links are exactly what{" "}
          <Link href="/autopilot" className="underline">
            Auto-Pilot
          </Link>{" "}
          can submit automatically.
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

      {jobs.length > 0 && (
        <>
          {(() => {
            // Describe what's actually in the list, not just jobs[0] — a mixed
            // list used to be labelled by whatever happened to be first.
            const LABELS: Record<string, string> = {
              "company-boards": "company career boards (Greenhouse/Lever/Ashby)",
              "yc-boards": "Y Combinator company boards",
              jsearch: "Google for Jobs (LinkedIn/Indeed/Glassdoor)",
              adzuna: "Adzuna",
              "ai-researched": "AI research",
            };
            const sources = Array.from(new Set(jobs.map((j) => j.source).filter(Boolean)));
            const unverifiedCount = jobs.filter((j) => !isVerifiedSource(j.source)).length;
            const names = sources.map((s) => LABELS[s] || s).join(" + ");

            if (unverifiedCount === jobs.length) {
              return (
                <div className="text-xs text-amberx-400 bg-amberx-500/10 border border-amberx-500/25 rounded-xl px-4 py-3 leading-relaxed">
                  ⚠ These are <b>AI-researched leads</b>, not verified listings — the company
                  may be real but the role and link may not be. Verify each one before
                  applying; Auto-Pilot won&apos;t submit to them.
                </div>
              );
            }
            return (
              <div className="text-xs text-neon-400 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3 leading-relaxed">
                ✓ {jobs.length - unverifiedCount} live listing
                {jobs.length - unverifiedCount === 1 ? "" : "s"} from {names}, scored by AI
                against your resume.
                {unverifiedCount > 0 && (
                  <> {unverifiedCount} AI-researched lead(s) are mixed in and marked separately.</>
                )}
              </div>
            );
          })()}
          <div className="grid gap-4">
            {jobs
              .slice()
              .sort((a, b) => b.matchScore - a.matchScore)
              .map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
          </div>
          <div className="card-pad flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-ink-300">
              Ready to apply? Auto-Apply prepares a tailored cover letter + screening
              answers for every job.
            </p>
            <Link href="/auto-apply" className="btn-primary">
              ➤ Go to Auto-Apply
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
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
          <span className={scoreTone}>{job.matchScore}% match</span>
          {job.salary && <span className="badge-blue">{job.salary}</span>}
        </div>
      </div>

      <p className="text-xs text-ink-400 mt-2">{job.recommendation}</p>

      <button
        className="text-xs text-neon-400 mt-3 hover:underline"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide analysis ▲" : "Full analysis ▼"}
      </button>

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
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-xs w-fit"
            >
              View listing ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
