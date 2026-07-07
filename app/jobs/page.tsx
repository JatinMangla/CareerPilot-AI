"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { Job } from "@/lib/types";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("react frontend developer");
  const [location, setLocation] = useState("India");
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
      // 1) try real listings (Adzuna) if configured
      setStatus("Checking live job APIs…");
      const live = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location }),
      }).then((r) => r.json());

      let result: { jobs: Job[] };
      if (live.available && live.listings?.length) {
        setStatus(`Analyzing ${live.listings.length} live listings against your resume…`);
        result = await jsonTask<{ jobs: Job[] }>("analyze_jobs", {
          jobs: live.listings,
          resume: resume.text,
        });
      } else {
        setStatus("Live API not configured — AI is researching matching openings…");
        result = await jsonTask<{ jobs: Job[] }>("find_jobs", {
          resume: resume.text,
          profile: store.getProfile(),
          count: 8,
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
      </div>

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
          {jobs[0]?.source === "ai-researched" && (
            <div className="text-xs text-amberx-400 bg-amberx-500/10 border border-amberx-500/25 rounded-xl px-4 py-3">
              These are AI-researched leads (no live job API key configured) — verify each
              on the portal before applying. Add free Adzuna keys in settings to get live
              listings.
            </div>
          )}
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
