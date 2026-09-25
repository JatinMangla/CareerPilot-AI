"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import { mapPool, AI_CONCURRENCY } from "@/lib/pool";
import { isBlockedListing } from "@/lib/jobFilters";
import { openTabs, blockedHint, TAB_BATCH } from "@/lib/openTabs";
import { safeHref } from "@/lib/safeUrl";
import { applicationStamp } from "@/lib/outcomes";
import { copyText } from "@/lib/clipboard";
import { useCancellable } from "@/lib/useCancellable";
import RunProgress from "@/components/RunProgress";
import { Pager, usePaged } from "@/components/Pager";
import { OUTCOME_STAGES, type Job, type OutcomeStage, type PreparedApplication, type Profile } from "@/lib/types";

const PAGE_SIZE = 15;

const ALL_PORTALS = [
  "Y Combinator",
  "LinkedIn",
  "Naukri",
  "Indeed",
  "Wellfound",
  "Instahyre",
  "Cutshort",
];

function portalSearchUrl(portal: string, job: Job): string {
  const q = encodeURIComponent(`${job.title} ${job.company}`);
  switch (portal) {
    case "Y Combinator":
      return `https://www.workatastartup.com/jobs?query=${encodeURIComponent(job.title)}`;
    case "LinkedIn":
      return `https://www.linkedin.com/jobs/search/?keywords=${q}`;
    case "Naukri":
      return `https://www.naukri.com/${job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-jobs?k=${q}`;
    case "Indeed":
      return `https://in.indeed.com/jobs?q=${q}`;
    case "Wellfound":
      return `https://wellfound.com/jobs?q=${q}`;
    case "Instahyre":
      return `https://www.instahyre.com/search-jobs/?q=${q}`;
    case "Cutshort":
      return `https://cutshort.io/jobs?q=${q}`;
    default:
      return job.url;
  }
}

/** The Apply Kits tab of /apply: cover letter + screening answers for any job, portals included. */
export default function ApplyKits() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [apps, setApps] = useState<PreparedApplication[]>([]);

  /**
   * Read-modify-write against the stored list, not the render's copy: a batch
   * run awaits for minutes, and writing back its starting copy undid every
   * outcome, removal or "applied" made in the meantime.
   */
  function updateApps(fn: (a: PreparedApplication[]) => PreparedApplication[]) {
    const next = fn(store.getApps());
    store.setApps(next);
    setApps(next);
  }
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const run = useCancellable();
  const [error, setError] = useState("");

  useEffect(() => {
    setJobs(store.getJobs());
    setApps(store.getApps());
    setProfile(store.getProfile());
  }, []);

  function togglePortal(p: string) {
    if (!profile) return;
    const portals = profile.portals.includes(p)
      ? profile.portals.filter((x) => x !== p)
      : [...profile.portals, p];
    const next = { ...profile, portals };
    setProfile(next);
    store.setProfile(next);
  }

  async function prepareSelected() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first.");
    const picked = jobs.filter((j) => selected[j.id] && !apps.some((a) => a.jobId === j.id));
    if (picked.length === 0) return setError("Select at least one job (not already prepared).");

    const MAX_PER_RUN = 25;
    let targets = picked;
    if (picked.length > MAX_PER_RUN) {
      const ok = window.confirm(
        `You selected ${picked.length} jobs, each a separate AI call.\n\n` +
          `Continue with the first ${MAX_PER_RUN}? (Run again for the rest.)`
      );
      if (!ok) return;
      targets = picked.slice(0, MAX_PER_RUN);
    }
    setError("");
    setBusy(true);
    const portal = profile?.portals[0] || "LinkedIn";
    const added: PreparedApplication[] = [];
    try {
      /*
       * These were prepared one at a time, so ten jobs meant ten deep-tier round
       * trips end to end — minutes of spinner. They are independent, so overlap
       * them. A failure no longer abandons the rest either: mapPool collects
       * per-job errors instead of throwing out of the loop.
       */
      const signal = run.start();
      const outcomes = await mapPool(
        targets,
        AI_CONCURRENCY,
        (job, _i, sig) =>
          jsonTask<{
            coverLetter: string;
            tailoredHighlights: string[];
            screeningAnswers: { question: string; answer: string }[];
          }>("prepare_application", { resume: resume.text, job, portal, profile }, { signal: sig }),
        (done, total) => setProgress(`Preparing applications… ${done}/${total} done`),
        signal
      );

      for (const { item: job, value: prep } of outcomes) {
        if (!prep) continue;
        added.push({
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          portal,
          url: job.url || portalSearchUrl(portal, job),
          status: "prepared",
          coverLetter: prep.coverLetter,
          tailoredHighlights: prep.tailoredHighlights,
          screeningAnswers: prep.screeningAnswers,
          at: Date.now(),
        });
      }
      if (added.length) store.bumpStat("applicationsPrepared", added.length);
      updateApps((all) => [...all, ...added]);

      const failed = outcomes.filter((o) => o.error);
      if (failed.length) {
        setError(
          `${failed.length} of ${targets.length} could not be prepared (${failed[0].error!.message}). ` +
            `The rest are ready — select the failed ones and run again.`
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function markApplied(jobId: string) {
    const job = jobs.find((j) => j.id === jobId);
    updateApps((all) =>
      all.map((a) =>
        a.jobId === jobId
          ? {
              ...a,
              status: "applied" as const,
              outcome: "applied" as const,
              outcomeAt: Date.now(),
              // What went out, so replies can be compared by channel, fit and
              // resume version rather than only counted.
              ...applicationStamp(job),
            }
          : a
      )
    );
  }

  /** What happened after applying — this is what makes the funnel meaningful. */
  function setOutcome(jobId: string, outcome: OutcomeStage) {
    updateApps((all) =>
      all.map((a) => (a.jobId === jobId ? { ...a, outcome, outcomeAt: Date.now() } : a))
    );
  }

  /**
   * `hideJob` is the fix for "I removed it and it came back".
   *
   * Removing only the prepared kit left the job in the match list, so the
   * "Queue jobs" list below offered it again immediately — and because job ids
   * are minted per search, a job-level removal keyed by id stopped matching as
   * soon as the next search ran. Dismissals are stored by company + title.
   */
  function removeApp(jobId: string, hideJob: boolean) {
    const app = apps.find((a) => a.jobId === jobId);
    if (hideJob) {
      const job = jobs.find((j) => j.id === jobId);
      const target = job || (app && { title: app.jobTitle, company: app.company });
      if (target) setJobs(store.dismissJob(target));
    }
    updateApps((all) => all.filter((a) => a.jobId !== jobId));
  }

  function dismissJob(job: Job) {
    setJobs(store.dismissJob(job));
  }

  /** Open the applications you haven't submitted yet, one tab each. */
  function openPending() {
    // Never-opened first, then least recently opened. Without the stamp every
    // click reopened the same first ten and the rest were unreachable.
    const pending = apps
      .filter((a) => a.status !== "applied" && a.url && !isBlockedListing(a.url, a.company))
      .sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0));
    if (!pending.length) return setError("Nothing left to open — everything is marked applied.");
    const batch = pending.slice(0, TAB_BATCH);
    const result = openTabs(batch.map((a) => a.url));
    setError(blockedHint(result));
    if (result.opened) {
      const now = Date.now();
      const ids = new Set(batch.slice(0, result.opened).map((a) => a.jobId));
      updateApps((all) => all.map((a) => (ids.has(a.jobId) ? { ...a, openedAt: now } : a)));
    }
  }

  const unprepared = jobs
    .filter((j) => !apps.some((a) => a.jobId === j.id) && !isBlockedListing(j.url, j.company))
    .sort((a, b) => b.matchScore - a.matchScore);
  const selectedCount = unprepared.filter((j) => selected[j.id]).length;

  // Paged for rendering only. Selection and "select top N" stay over the whole
  // list — the point of those buttons is to reach past what is on screen.
  const queuePage = usePaged(unprepared, PAGE_SIZE, null);
  const appsList = useMemo(() => apps.slice().reverse(), [apps]);
  const appsPage = usePaged(appsList, PAGE_SIZE, null);

  /** Tick the n best matches at once — this list can be a hundred jobs long. */
  function selectTop(n: number) {
    setSelected(Object.fromEntries(unprepared.slice(0, n).map((j) => [j.id, true])));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="h2">Apply Kits</h2>
        <p className="muted mt-1">
          The AI prepares each application end-to-end — tailored cover letter, resume
          bullets, screening answers — then hands you one-click submission links.
        </p>
      </div>

      <div className="text-xs text-ink-300 bg-sky2-500/10 border border-sky2-500/25 rounded-xl px-4 py-3 leading-relaxed">
        <b className="text-sky2-400">Why not fully automatic?</b> Bot-submitting on
        LinkedIn/Naukri violates their terms and gets accounts banned. This pipeline does
        100% of the work except the final click — your accounts stay safe and every
        application is verified by you.
      </div>

      {/* Portal preferences */}
      <div className="card-pad">
        <h2 className="h2 mb-3">Target portals</h2>
        <div className="flex flex-wrap gap-2">
          {ALL_PORTALS.map((p) => {
            const on = profile?.portals.includes(p);
            return (
              <button
                key={p}
                onClick={() => togglePortal(p)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold border transition ${
                  on
                    ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                    : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
                }`}
              >
                {on ? "✓ " : ""}
                {p}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-ink-400 mt-2">
          Each prepared application includes direct search links for your selected portals.
        </p>
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Select jobs to prepare */}
      <div className="card-pad space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="h2">
            Queue jobs
            <span className="text-ink-400 font-normal text-sm ml-2">
              ({selectedCount} of {unprepared.length} selected)
            </span>
          </h2>
          <button className="btn-primary" onClick={prepareSelected} disabled={busy}>
            {busy ? "Preparing…" : `➤ Prepare ${selectedCount || "selected"} application(s)`}
          </button>
        </div>
        {unprepared.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => selectTop(10)}>
              Top 10 matches
            </button>
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => selectTop(25)}>
              Top 25
            </button>
            <button
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => selectTop(unprepared.length)}
            >
              Select all
            </button>
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => setSelected({})}>
              Clear
            </button>
          </div>
        )}
        <RunProgress text={progress} onStop={busy ? run.cancel : undefined} />
        {unprepared.length === 0 && (
          <p className="text-sm text-ink-400">
            No unprepared jobs in your list.{" "}
            <Link href="/jobs" className="text-neon-400 underline">
              Find matches first →
            </Link>
          </p>
        )}
        {queuePage.pageItems.map((job) => (
          <label
            key={job.id}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-ink-850 hover:bg-ink-800 cursor-pointer"
          >
            <input
              type="checkbox"
              className="accent-[#17c996] w-4 h-4"
              checked={!!selected[job.id]}
              onChange={(e) => setSelected({ ...selected, [job.id]: e.target.checked })}
            />
            <span className="text-sm text-ink-100">{job.title}</span>
            <span className="text-xs text-ink-400">@ {job.company}</span>
            <span className="ml-auto flex items-center gap-2">
              <span className="badge-green">{job.aiScored === false ? `~${job.matchScore}` : `${job.matchScore}%`}</span>
              <button
                className="text-[11px] text-coral-400 hover:underline"
                title="Hide this job for good"
                aria-label={`Hide ${job.title} at ${job.company} for good`}
                onClick={(e) => {
                  e.preventDefault();
                  dismissJob(job);
                }}
              >
                ✕
              </button>
            </span>
          </label>
        ))}
        <Pager
          page={queuePage.page}
          pageCount={queuePage.pageCount}
          total={unprepared.length}
          unit="jobs"
          onPage={queuePage.setPage}
        />
      </div>

      {/* Prepared applications */}
      {apps.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="h2">
              Prepared applications ({apps.filter((a) => a.status === "applied").length}{" "}
              applied / {apps.length})
            </h2>
            <button className="btn-secondary text-xs" onClick={openPending}>
              ↗ Open next {TAB_BATCH} in tabs
            </button>
          </div>
          {appsPage.pageItems.map((app) => (
            <AppCard
              key={app.jobId}
              app={app}
              portals={profile?.portals || []}
              job={jobs.find((j) => j.id === app.jobId)}
              onApplied={() => markApplied(app.jobId)}
              onOutcome={(o) => setOutcome(app.jobId, o)}
              onRemove={(hideJob) => removeApp(app.jobId, hideJob)}
            />
          ))}
          <Pager
            page={appsPage.page}
            pageCount={appsPage.pageCount}
            total={appsList.length}
            unit="applications"
            onPage={appsPage.setPage}
          />
        </div>
      )}
    </div>
  );
}

function AppCard({
  app,
  portals,
  job,
  onApplied,
  onOutcome,
  onRemove,
}: {
  app: PreparedApplication;
  portals: string[];
  job?: Job;
  onApplied: () => void;
  onOutcome: (o: OutcomeStage) => void;
  onRemove: (hideJob: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");

  async function copy(label: string, text: string) {
    // Reports a failed copy instead of claiming success: an empty paste into an
    // application form is worse than a visible error.
    const ok = await copyText(text);
    setCopied(ok ? label : `failed:${label}`);
    setTimeout(() => setCopied(""), ok ? 1500 : 3000);
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display font-bold text-ink-100">{app.jobTitle}</h3>
          <p className="text-sm text-ink-300">{app.company}</p>
        </div>
        <div className="flex items-center gap-2">
          {app.status === "applied" ? (
            <span className="badge-green">✓ Applied</span>
          ) : (
            <span className="badge-amber">Prepared — ready to submit</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {job &&
          portals.map((p) => (
            <a
              key={p}
              href={portalSearchUrl(p, job)}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Apply on {p} ↗
            </a>
          ))}
        {safeHref(app.url) && (
          <a href={safeHref(app.url)} target="_blank" rel="noreferrer" className="btn-secondary text-xs px-3 py-1.5">
            Direct listing ↗
          </a>
        )}
        {app.status !== "applied" && (
          <button className="btn-primary text-xs px-3 py-1.5" onClick={onApplied}>
            Mark as applied
          </button>
        )}
        <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => onRemove(false)}>
          Discard kit
        </button>
        <button
          className="btn-danger text-xs px-3 py-1.5"
          title="Removes the kit and hides this job for good"
          onClick={() => onRemove(true)}
        >
          Not interested
        </button>
      </div>

      {app.status === "applied" && (
        <div className="mt-3 pt-3 border-t border-ink-800">
          <p className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-2">
            What happened?
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {OUTCOME_STAGES.map((o) => (
              <button
                key={o}
                onClick={() => onOutcome(o)}
                aria-pressed={app.outcome === o}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border capitalize transition ${
                  app.outcome === o
                    ? o === "offer"
                      ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                      : o === "rejected" || o === "ghosted"
                      ? "bg-coral-500/15 text-coral-400 border-coral-500/40"
                      : "bg-sky2-500/15 text-sky2-400 border-sky2-500/40"
                    : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="text-xs text-neon-400 mt-3 hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Hide application kit ▲" : "Open application kit ▼"}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink-300">
                Cover letter
              </h4>
              <div className="flex gap-3">
                <button
                  className="text-xs text-neon-400 hover:underline"
                  onClick={async () => {
                    const { buildLetterPdf, downloadBlob } = await import("@/lib/pdf/resumeDoc");
                    const { store } = await import("@/lib/store");
                    const name = store.getProfile().name || "Candidate";
                    downloadBlob(
                      await buildLetterPdf(
                        name,
                        `Cover Letter — ${app.jobTitle}, ${app.company}`,
                        app.coverLetter
                      ),
                      `${name.replace(/\s+/g, "_")}_CoverLetter_${app.company.replace(/\s+/g, "_")}.pdf`
                    );
                  }}
                >
                  ⬇ PDF
                </button>
                <button
                  className="text-xs text-neon-400 hover:underline"
                  onClick={() => copy("cover", app.coverLetter)}
                >
                  {copied === "cover" ? "Copied ✓" : copied === "failed:cover" ? "Copy failed" : "Copy"}
                </button>
              </div>
            </div>
            <p className="text-xs text-ink-200 leading-relaxed bg-ink-850 rounded-xl p-3 whitespace-pre-wrap">
              {app.coverLetter}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink-300">
                Tailored resume bullets
              </h4>
              <button
                className="text-xs text-neon-400 hover:underline"
                onClick={() => copy("bullets", app.tailoredHighlights.join("\n"))}
              >
                {copied === "bullets" ? "Copied ✓" : copied === "failed:bullets" ? "Copy failed" : "Copy all"}
              </button>
            </div>
            <ul className="space-y-1.5 bg-ink-850 rounded-xl p-3">
              {app.tailoredHighlights.map((h, i) => (
                <li key={i} className="text-xs text-ink-200 flex gap-2">
                  <span className="text-neon-400">▸</span> {h}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink-300 mb-1.5">
              Screening answers
            </h4>
            <div className="space-y-2">
              {app.screeningAnswers.map((qa, i) => (
                <div key={i} className="bg-ink-850 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink-100">{qa.question}</p>
                    <button
                      className="text-xs text-neon-400 hover:underline shrink-0"
                      onClick={() => copy(`qa${i}`, qa.answer)}
                    >
                      {copied === `qa${i}` ? "✓" : copied === `failed:qa${i}` ? "failed" : "Copy"}
                    </button>
                  </div>
                  <p className="text-xs text-ink-300 mt-1 leading-relaxed">{qa.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
