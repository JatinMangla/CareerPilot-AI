"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask, streamTask } from "@/lib/aiClient";
import { mapPool, AI_CONCURRENCY } from "@/lib/pool";
import { detectAts, isVerifiedSource } from "@/lib/ats";
import { openTabs, blockedHint, TAB_BATCH } from "@/lib/openTabs";
import { safeHref } from "@/lib/safeUrl";
import { isBlockedListing } from "@/lib/jobFilters";
import { Pager, usePaged } from "@/components/Pager";
import { OUTCOME_STAGES, type AutoTailorPlan, type Job, type OutcomeStage, type QueuedApplication } from "@/lib/types";
import { applicationStamp } from "@/lib/outcomes";
import { useCancellable } from "@/lib/useCancellable";
import RunProgress from "@/components/RunProgress";

const PAGE_SIZE = 15;

export default function AutoPilotPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queue, setQueue] = useState<QueuedApplication[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const run = useCancellable();
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setJobs(store.getJobs());
    setQueue(store.getQueue());
  }, []);

  function saveQueue(q: QueuedApplication[]) {
    store.setQueue(q);
    setQueue([...q]);
  }

  /**
   * Read-modify-write against the stored queue, not the render's copy. A batch
   * run awaits for minutes; writing back the copy it started with undid every
   * Discard, Mark submitted or Open made in the meantime.
   */
  function updateQueue(fn: (q: QueuedApplication[]) => QueuedApplication[]) {
    saveQueue(fn(store.getQueue()));
  }

  /** Step 1 — AI tailors each selected job, splitting safe vs new claims. */
  async function prepareSelected() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first on the My Resume page.");
    const picked = jobs.filter(
      (j) => selected[j.id] && !queue.some((q) => q.jobId === j.id)
    );
    if (!picked.length) return setError("Select at least one job that isn't queued yet.");

    // AI-researched leads are plausible-looking guesses — the company, the role
    // and the URL may not exist. They're fine to read as leads; they must not
    // reach the apply queue, where they'd cost a deep tailoring pass each and
    // send you to a page that isn't there.
    const unverified = picked.filter((j) => !isVerifiedSource(j.source));
    if (unverified.length) {
      return setError(
        `${unverified.length} of these are AI-researched leads, not verified listings ` +
          `(${unverified.slice(0, 3).map((j) => j.company).join(", ")}${unverified.length > 3 ? "…" : ""}). ` +
          `Their URLs may not exist, so Auto-Pilot won't prepare them. ` +
          `Use the "Company boards" or "Y Combinator" source on the Job Matches page for real, applyable roles.`
      );
    }

    // Each job is one deep-tier AI call. The cap exists so a stray click can't
    // burn the day's free quota in one go — not to limit how much you apply
    // for, which is why it asks rather than silently truncating.
    const MAX_PER_RUN = 25;
    let targets = picked;
    if (picked.length > MAX_PER_RUN) {
      const ok = window.confirm(
        `You selected ${picked.length} jobs. Each one is a full AI tailoring pass.\n\n` +
          `Continue with the first ${MAX_PER_RUN}? (Run again for the rest.)`
      );
      if (!ok) return;
      targets = picked.slice(0, MAX_PER_RUN);
    }

    setError("");
    setBusy(true);
    const added: QueuedApplication[] = [];
    try {
      // Ten independent deep-tier passes ran back to back here, so the wait was
      // the sum of all ten. Overlap them; the per-job failure handling below is
      // unchanged, since mapPool reports errors per item instead of throwing.
      const profile = store.getProfile();
      const signal = run.start();
      const outcomes = await mapPool(
        targets,
        AI_CONCURRENCY,
        (job, _i, sig) =>
          jsonTask<AutoTailorPlan>(
            "auto_tailor",
            { resume: resume.text, job, profile },
            { signal: sig }
          ),
        (done, total) => setProgress(`Tailoring… ${done}/${total} done`),
        signal
      );

      let quotaError = "";
      let stopped = 0;
      for (const { item: job, value: plan, error, skipped } of outcomes) {
        // Cancelled before it ran: it stays selectable rather than becoming a
        // "failed" card.
        if (skipped) {
          stopped++;
          continue;
        }
        // Out of free quota is not this job's fault either: leave it selectable
        // for the next run instead of parking it behind a dead card.
        if (!plan && /rate-limited|quota/i.test(error?.message || "")) {
          quotaError = error!.message;
          continue;
        }
        const ats = detectAts(job.url);
        const base = {
          jobId: job.id,
          title: job.title,
          company: job.company,
          url: job.url,
          atsKind: ats.kind,
          atsLabel: ats.label,
          autoSubmit: ats.autoSubmit,
          approvedClaimIds: [],
          at: Date.now(),
        };

        if (plan) {
          const needsApproval = (plan.newClaims?.length || 0) > 0;
          added.push({
            ...base,
            status: needsApproval ? "needs_approval" : "approved",
            plan,
            finalResume: plan.tailoredResume,
          });
        } else {
          added.push({
            ...base,
            status: "failed",
            plan: null,
            finalResume: "",
            error: error?.message || "Tailoring failed",
          });
        }
      }
      updateQueue((q) => [...q, ...added]);
      if (quotaError) setError(quotaError);
      else if (stopped) setError(`Stopped — ${stopped} job${stopped === 1 ? "" : "s"} not tailored; they are still selectable.`);
    } finally {
      setBusy(false);
      setProgress("");
      setSelected({});
    }
  }

  /** Step 2 — you approve/reject each new claim, then AI merges approved ones. */
  async function applyApprovals(item: QueuedApplication, approvedIds: string[], answers: string) {
    setError("");
    setBusy(true);
    setProgress(`Finalizing resume for ${item.company}…`);
    try {
      const approvedClaims = (item.plan?.newClaims || []).filter((c) =>
        approvedIds.includes(c.id)
      );
      let finalResume = item.plan!.tailoredResume;
      if (approvedClaims.length > 0) {
        finalResume = await streamTask(
          "merge_claims",
          {
            resume: item.plan!.tailoredResume,
            approvedClaims,
            answers,
            profile: store.getProfile(),
          },
          () => {}
        );
      }
      updateQueue((all) => all.map((q) =>
        q.jobId === item.jobId
          ? {
              ...q,
              status: "approved" as const,
              approvedClaimIds: approvedIds,
              finalResume: finalResume.trim(),
            }
          : q
      ));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function removeItem(jobId: string, alsoHideJob: boolean) {
    // Removing a queued application used to leave the job sitting in the match
    // list, so the very next visit offered it again — which is what made it
    // look like removals did nothing.
    if (alsoHideJob) {
      const job = jobs.find((j) => j.id === jobId);
      const q = queue.find((x) => x.jobId === jobId);
      const target = job || (q && { title: q.title, company: q.company });
      if (target) setJobs(store.dismissJob(target));
    }
    updateQueue((all) => all.filter((q) => q.jobId !== jobId));
  }

  function markSubmitted(jobId: string) {
    // Recorded as an application, so Auto-Pilot sends reach the funnel — before,
    // "Mark submitted" set no outcome and the dashboard never counted them.
    const job = jobs.find((j) => j.id === jobId);
    updateQueue((all) =>
      all.map((q) =>
        q.jobId === jobId
          ? {
              ...q,
              status: "submitted" as const,
              outcome: q.outcome ?? ("applied" as const),
              outcomeAt: q.outcomeAt ?? Date.now(),
              ...applicationStamp(job),
            }
          : q
      )
    );
  }

  function setOutcome(jobId: string, outcome: OutcomeStage) {
    updateQueue((all) =>
      all.map((q) => (q.jobId === jobId ? { ...q, outcome, outcomeAt: Date.now() } : q))
    );
  }

  /**
   * Step 4 — open every ready application in its own tab.
   *
   * This replaced automated submission. The agent used to click Submit for you
   * on Greenhouse/Lever/Ashby; now nothing is ever sent without you seeing it.
   * Everything up to the final button is still done for you — tailored resume,
   * cover letter, screening answers — so each tab is a review and one click.
   */
  function openReady() {
    const ready = queue.filter(
      (q) =>
        (q.status === "approved" || q.status === "exported") &&
        q.url &&
        !isBlockedListing(q.url, q.company)
    );
    if (!ready.length) return setError("Nothing approved to open yet.");

    const batch = ready.slice(0, TAB_BATCH);
    const result = openTabs(batch.map((q) => q.url));
    const hint = blockedHint(result);
    setError(hint);

    if (result.opened) {
      const ids = new Set(batch.slice(0, result.opened).map((q) => q.jobId));
      updateQueue((all) =>
        all.map((q) => (ids.has(q.jobId) ? { ...q, status: "opened" as const } : q))
      );
    }
    if (!hint) {
      const left = ready.length - batch.length;
      const msg =
        `Opened ${result.opened} application${result.opened === 1 ? "" : "s"} in new tabs — ` +
        `your kit for each is below. ${left > 0 ? `${left} still queued: click again for the next batch.` : ""}`;
      setProgress(msg);
      // Clears only its own message — a run started within the 8s kept losing
      // its progress line to this timer.
      setTimeout(() => setProgress((p) => (p === msg ? "" : p)), 8000);
    }
  }

  /** Step 3 — export the approved queue (with PDFs) for the local agent. */
  async function exportQueue() {
    const approved = queue.filter((q) => q.status === "approved");
    if (!approved.length) return setError("Nothing approved to export yet.");
    setError("");
    setExporting(true);
    try {
      const { buildResumePdf, downloadBlob } = await import("@/lib/pdf/resumeDoc");
      const profile = store.getProfile();
      const tplRaw = window.localStorage.getItem("cp_pdf_template");
      const tpl = tplRaw === "modern" ? "modern" : "classic";

      const applications = [];
      for (const item of approved) {
        const blob = await buildResumePdf(item.finalResume, profile.name, tpl);
        const buf = await blob.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        applications.push({
          jobId: item.jobId,
          title: item.title,
          company: item.company,
          url: item.url,
          ats: item.atsKind,
          autoSubmit: item.autoSubmit,
          coverLetter: item.plan?.coverLetter || "",
          screeningAnswers: item.plan?.screeningAnswers || [],
          resumePdfBase64: btoa(binary),
          resumeFileName: `${profile.name.replace(/\s+/g, "_")}_Resume_${item.company.replace(
            /[^A-Za-z0-9]+/g,
            "_"
          )}.pdf`,
        });
      }

      const payload = {
        generatedAt: new Date().toISOString(),
        profile: {
          name: profile.name,
          email: profile.email,
          phone: profile.phone || "",
          location: profile.locations,
          linkedin: profile.linkedin || "",
          github: profile.github || "",
          portfolio: profile.portfolio || "",
          noticePeriod: profile.noticePeriod || "",
          expectedCtc: profile.expectedCtc || "",
        },
        applications,
      };
      downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        "apply-queue.json"
      );
      const exportedIds = new Set(approved.map((q) => q.jobId));
      updateQueue((all) =>
        all.map((q) =>
          q.status === "approved" && exportedIds.has(q.jobId)
            ? { ...q, status: "exported" as const }
            : q
        )
      );
    } catch (err: any) {
      setError(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  const unqueued = jobs
    .filter((j) => !queue.some((q) => q.jobId === j.id) && !isBlockedListing(j.url, j.company))
    .sort((a, b) => b.matchScore - a.matchScore);
  // Rendering is paged; selection and "queue top N" still span the whole list.
  const unqueuedPage = usePaged(unqueued, PAGE_SIZE, null);
  const queueList = useMemo(() => queue.slice().reverse(), [queue]);
  const queuePage = usePaged(queueList, PAGE_SIZE, null);

  const counts = {
    needs: queue.filter((q) => q.status === "needs_approval").length,
    approved: queue.filter((q) => q.status === "approved").length,
    exported: queue.filter((q) => q.status === "exported").length,
    opened: queue.filter((q) => q.status === "opened").length,
    submitted: queue.filter((q) => q.status === "submitted").length,
  };
  const readyToOpen = queue.filter(
    (q) => q.status === "approved" || q.status === "exported"
  ).length;
  const selectedCount = unqueued.filter((j) => selected[j.id]).length;

  /**
   * Selects the n best-matching jobs that Auto-Pilot can actually prepare.
   *
   * AI-researched leads are skipped: they fail the verified-source gate in
   * `prepareSelected`, so including them would only produce an error telling
   * you to deselect them again.
   */
  function selectTop(n: number) {
    const picks = unqueued
      .filter((j) => isVerifiedSource(j.source))
      .slice()
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, n);
    setSelected(Object.fromEntries(picks.map((j) => [j.id, true])));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Auto-Pilot</h1>
        <p className="muted mt-1">
          AI tailors your resume per job, asks you only when it would need to claim
          something new, exports a ready-to-paste kit, then opens every application in
          its own tab — you press Submit.
        </p>
      </div>

      {/* How it works */}
      <div className="grid sm:grid-cols-4 gap-3">
        {[
          { n: "1", t: "Tailor", d: "AI rewrites your resume for each job using only real experience." },
          { n: "2", t: "Approve", d: "If it needs a claim you haven't made, it asks you first." },
          { n: "3", t: "Export", d: "Download the queue — tailored PDFs and answers included." },
          { n: "4", t: "Open & apply", d: "Every application opens in its own tab. Nothing is ever submitted for you." },
        ].map((s) => (
          <div key={s.n} className="card p-4">
            <span className="grid place-items-center w-6 h-6 rounded-full bg-neon-500/15 text-neon-400 text-xs font-bold border border-neon-500/30">
              {s.n}
            </span>
            <div className="font-semibold text-sm mt-2 text-ink-100">{s.t}</div>
            <p className="text-xs text-ink-400 mt-1 leading-relaxed">{s.d}</p>
          </div>
        ))}
      </div>

      <div className="text-xs text-ink-300 bg-sky2-500/10 border border-sky2-500/25 rounded-xl px-4 py-3 leading-relaxed">
        <b className="text-sky2-400">You press Submit — always.</b> Auto-Pilot does every
        step except the last one: it tailors the resume, writes the cover letter, answers
        the screening questions, then opens each application in its own tab with the kit
        beside it. Nothing is submitted on your behalf, so no application goes out that
        you haven&apos;t seen and no account is ever at risk. Applying direct on the
        company&apos;s own ATS still beats a portal: far fewer applicants, and it lands
        straight in the employer&apos;s system rather than in{" "}
        <Link href="/auto-apply" className="underline">
          a queue behind ten thousand others
        </Link>
        .
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      <RunProgress text={progress} onStop={busy ? run.cancel : undefined} />

      {/* Queue jobs */}
      <div className="card-pad space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="h2">
            Pick jobs to apply for
            <span className="text-ink-400 font-normal text-sm ml-2">
              ({selectedCount} of {unqueued.length} selected)
            </span>
          </h2>
          <button className="btn-primary" onClick={prepareSelected} disabled={busy}>
            {busy ? "Working…" : `✦ Tailor & queue ${selectedCount || "selected"}`}
          </button>
        </div>
        {/* Ticking eighty boxes by hand is what stopped this being used at
            volume — the whole point is applying to a lot of jobs. */}
        {unqueued.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => selectTop(10)}>
              Top 10 matches
            </button>
            <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => selectTop(25)}>
              Top 25
            </button>
            <button
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => selectTop(unqueued.length)}
            >
              Select all applyable
            </button>
            <button
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => setSelected({})}
            >
              Clear
            </button>
          </div>
        )}
        {unqueued.length === 0 ? (
          <p className="text-sm text-ink-400">
            No new jobs.{" "}
            <Link href="/jobs" className="text-neon-400 underline">
              Find matches first →
            </Link>
          </p>
        ) : (
          unqueuedPage.pageItems.map((job) => {
            const ats = detectAts(job.url);
            return (
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
                  {!isVerifiedSource(job.source) ? (
                    <span className="badge-red" title="AI-researched lead — the URL may not exist, so Auto-Pilot won't prepare it">
                      ⚠ unverified
                    </span>
                  ) : (
                    <span
                      className={
                        ats.autoSubmit ? "badge-green" : ats.autoFill ? "badge-amber" : "badge-red"
                      }
                      title={ats.note}
                    >
                      {ats.label}
                    </span>
                  )}
                  <span className="badge-blue">{job.aiScored === false ? `~${job.matchScore}` : `${job.matchScore}%`}</span>
                  <button
                    className="text-[11px] text-coral-400 hover:underline"
                    title="Hide this job for good"
                    aria-label={`Hide ${job.title} at ${job.company} for good`}
                    onClick={(e) => {
                      e.preventDefault();
                      setJobs(store.dismissJob(job));
                    }}
                  >
                    ✕
                  </button>
                </span>
              </label>
            );
          })
        )}
        <Pager
          page={unqueuedPage.page}
          pageCount={unqueuedPage.pageCount}
          total={unqueued.length}
          unit="jobs"
          onPage={unqueuedPage.setPage}
        />
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="h2">
              Queue — {counts.needs} need you · {counts.approved} ready · {counts.exported}{" "}
              exported · {counts.opened} opened · {counts.submitted} submitted
            </h2>
            <div className="flex gap-2 flex-wrap">
              <button
                className="btn-secondary"
                onClick={exportQueue}
                disabled={exporting || counts.approved === 0}
              >
                {exporting ? "Building PDFs…" : `⬇ Export ${counts.approved} (PDFs + answers)`}
              </button>
              <button className="btn-primary" onClick={openReady} disabled={readyToOpen === 0}>
                ↗ Open {Math.min(readyToOpen, TAB_BATCH)} application
                {Math.min(readyToOpen, TAB_BATCH) === 1 ? "" : "s"} in tabs
              </button>
            </div>
          </div>

          {queuePage.pageItems.map((item) => (
            <QueueCard
              key={item.jobId}
              item={item}
              busy={busy}
              onApprove={applyApprovals}
              onRemove={(hideJob) => removeItem(item.jobId, hideJob)}
              onSubmitted={() => markSubmitted(item.jobId)}
              onOutcome={(o) => setOutcome(item.jobId, o)}
            />
          ))}
          <Pager
            page={queuePage.page}
            pageCount={queuePage.pageCount}
            total={queueList.length}
            unit="queued"
            onPage={queuePage.setPage}
          />
        </div>
      )}

      {/* Optional local agent */}
      <div className="card-pad">
        <h2 className="h2 mb-3">Optional: the local form-filler</h2>
        <p className="text-sm text-ink-300 leading-relaxed">
          You don&apos;t need this — <b className="text-ink-100">Open in tabs</b> above is
          the normal route. The local agent is for when you&apos;d rather not retype the
          same answers into twenty forms: it opens each application in a real browser on
          your machine and fills every field it recognizes, then stops and hands you the
          keyboard. <b className="text-ink-100">It never submits anything.</b>
        </p>
        <ol className="text-sm text-ink-300 space-y-2 list-decimal list-inside leading-relaxed mt-3">
          <li>
            In your project folder run:{" "}
            <code className="text-neon-400 text-xs">cd agent &amp;&amp; npm install</code>
          </li>
          <li>
            Move the downloaded <code className="text-xs">apply-queue.json</code> into the{" "}
            <code className="text-xs">agent/</code> folder.
          </li>
          <li>
            Open every application in its own tab, nothing filled:{" "}
            <code className="text-neon-400 text-xs">npm run apply -- --open</code>
          </li>
          <li>
            Or open and auto-fill each one for you to check and submit:{" "}
            <code className="text-neon-400 text-xs">npm run apply</code>
          </li>
        </ol>
        <p className="text-xs text-ink-400 mt-3 leading-relaxed">
          The agent runs on your machine in a visible browser so you can watch every step.
          It pauses for CAPTCHAs and any question it isn&apos;t confident about, and writes{" "}
          <code className="text-xs">results.json</code> when finished.
        </p>
      </div>
    </div>
  );
}

function QueueCard({
  item,
  busy,
  onApprove,
  onRemove,
  onSubmitted,
  onOutcome,
}: {
  item: QueuedApplication;
  busy: boolean;
  onApprove: (item: QueuedApplication, ids: string[], answers: string) => void;
  onRemove: (hideJob: boolean) => void;
  onSubmitted: () => void;
  onOutcome: (outcome: OutcomeStage) => void;
}) {
  const [open, setOpen] = useState(item.status === "needs_approval");
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const tone =
    item.status === "failed"
      ? "badge-red"
      : item.status === "needs_approval"
      ? "badge-amber"
      : item.status === "submitted"
      ? "badge-green"
      : "badge-blue";

  const label = {
    planning: "Planning",
    needs_approval: "⚠ Needs your approval",
    approved: "✓ Ready — open and submit",
    exported: "Exported (PDF + answers)",
    opened: "↗ Opened in a tab",
    submitted: "✓ Submitted",
    failed: "Failed",
  }[item.status];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display font-bold text-ink-100">{item.title}</h3>
          <p className="text-sm text-ink-300">
            {item.company} · <span className="text-ink-400">{item.atsLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={tone}>{label}</span>
          {item.autoSubmit && (
            <span className="badge-green" title="Standard single-page form — filled completely, so it is a read and one click">
              one-click form
            </span>
          )}
        </div>
      </div>

      {item.error && <p className="text-xs text-coral-400 mt-2">{item.error}</p>}
      {item.plan && <p className="text-xs text-ink-300 mt-2 leading-relaxed">{item.plan.summary}</p>}

      <div className="flex gap-3 mt-3 flex-wrap">
        <button className="text-xs text-neon-400 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Hide details ▲" : "Review details ▼"}
        </button>
        {safeHref(item.url) && (
          <a
            href={safeHref(item.url)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-ink-400 hover:text-ink-200"
          >
            Open listing ↗
          </a>
        )}
        {item.status !== "submitted" && item.status !== "failed" && (
          <button className="text-xs text-neon-400 hover:underline" onClick={onSubmitted}>
            Mark submitted
          </button>
        )}
        {item.status === "submitted" && (
          <label className="text-xs text-ink-400 flex items-center gap-1.5">
            What happened:
            <select aria-label="Outcome of this application"
              className="bg-ink-850 border border-ink-700 rounded-md px-1.5 py-0.5 text-ink-200"
              value={item.outcome || "applied"}
              onChange={(e) => onOutcome(e.target.value as OutcomeStage)}
            >
              {OUTCOME_STAGES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="text-xs text-ink-400 hover:text-ink-200" onClick={() => onRemove(false)}>
          Discard kit
        </button>
        {/* "Not interested" also hides the job itself, so the match list stops
            offering it back on every visit. */}
        <button className="text-xs text-coral-400 hover:underline" onClick={() => onRemove(true)}>
          Not interested
        </button>
      </div>

      {open && item.plan && (
        <div className="mt-4 space-y-4">
          {/* Safe changes */}
          {item.plan.safeChanges.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-neon-400 mb-2">
                Applied automatically ({item.plan.safeChanges.length}) — reframed from your
                real experience
              </h4>
              <div className="space-y-2">
                {item.plan.safeChanges.map((c) => (
                  <div key={c.id} className="bg-ink-850 rounded-xl p-3">
                    <span className="badge-blue text-[10px]">{c.section}</span>
                    {c.before !== "NEW" && (
                      <p className="text-xs text-ink-400 line-through mt-1.5">{c.before}</p>
                    )}
                    <p className="text-xs text-neon-400 mt-1">{c.after}</p>
                    <p className="text-[11px] text-ink-500 italic mt-1">{c.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New claims — approval gate */}
          {item.status === "needs_approval" && item.plan.newClaims.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-amberx-400 mb-2">
                The AI needs your OK ({item.plan.newClaims.length}) — these aren&apos;t in
                your resume yet
              </h4>
              <div className="space-y-3">
                {item.plan.newClaims.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-xl p-3 border transition ${
                      approved[c.id]
                        ? "border-neon-500/40 bg-neon-500/5"
                        : "border-ink-700 bg-ink-850"
                    }`}
                  >
                    <p className="text-sm text-ink-100 font-semibold">{c.question}</p>
                    <p className="text-xs text-neon-400 mt-2">Would add: {c.after}</p>
                    <p className="text-[11px] text-ink-500 italic mt-1">{c.reason}</p>
                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        className={
                          approved[c.id]
                            ? "btn-primary text-xs px-3 py-1.5"
                            : "btn-secondary text-xs px-3 py-1.5"
                        }
                        onClick={() => setApproved({ ...approved, [c.id]: true })}
                      >
                        Yes, true
                      </button>
                      <button
                        className={
                          approved[c.id] === false
                            ? "btn-danger text-xs px-3 py-1.5"
                            : "btn-secondary text-xs px-3 py-1.5"
                        }
                        onClick={() => setApproved({ ...approved, [c.id]: false })}
                      >
                        No, skip
                      </button>
                      {approved[c.id] && (
                        <input
                          className="input text-xs py-1.5 flex-1 min-w-[140px]"
                          placeholder="Optional detail (e.g. 8 months, at Mera Monitor)"
                          value={answers[c.id] || ""}
                          onChange={(e) =>
                            setAnswers({ ...answers, [c.id]: e.target.value })
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="btn-primary mt-3"
                disabled={busy}
                onClick={() =>
                  onApprove(
                    item,
                    Object.keys(approved).filter((k) => approved[k]),
                    item.plan!.newClaims
                      .filter((c) => approved[c.id])
                      .map((c) => `${c.question} → YES. ${answers[c.id] || ""}`)
                      .join("\n")
                  )
                }
              >
                ✓ Confirm and finalize resume
              </button>
            </div>
          )}

          {/* Screening answers */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink-300 mb-2">
              Form answers the agent will use
            </h4>
            <div className="space-y-1.5">
              {item.plan.screeningAnswers.map((qa, i) => (
                <div key={i} className="bg-ink-850 rounded-lg p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-ink-100">{qa.question}</p>
                    <span
                      className={
                        qa.confidence === "high" ? "badge-green text-[10px]" : "badge-amber text-[10px]"
                      }
                    >
                      {qa.confidence === "high" ? "auto" : "asks you"}
                    </span>
                  </div>
                  <p className="text-xs text-ink-300 mt-1">{qa.answer}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Final resume preview */}
          {item.finalResume && (
            <details>
              <summary className="text-xs text-ink-300 cursor-pointer hover:text-ink-100">
                Preview final resume for this job
              </summary>
              <pre className="prose-out card p-3 mt-2 max-h-72 overflow-auto text-[11px]">
                {item.finalResume}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
