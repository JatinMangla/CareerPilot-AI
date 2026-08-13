"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask, streamTask } from "@/lib/aiClient";
import { detectAts } from "@/lib/ats";
import type { AutoTailorPlan, Job, QueuedApplication } from "@/lib/types";

export default function AutoPilotPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queue, setQueue] = useState<QueuedApplication[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
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

  /** Step 1 — AI tailors each selected job, splitting safe vs new claims. */
  async function prepareSelected() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first on the My Resume page.");
    const picked = jobs.filter(
      (j) => selected[j.id] && !queue.some((q) => q.jobId === j.id)
    );
    if (!picked.length) return setError("Select at least one job that isn't queued yet.");

    // Each job is one deep-tier AI call. Cap the run so a stray click can't
    // spend a day's budget in one go.
    const MAX_PER_RUN = 10;
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
    const next = [...queue];
    try {
      for (let i = 0; i < targets.length; i++) {
        const job = targets[i];
        setProgress(`Tailoring ${i + 1}/${targets.length}: ${job.title} @ ${job.company}…`);
        const ats = detectAts(job.url);
        try {
          const plan = await jsonTask<AutoTailorPlan>("auto_tailor", {
            resume: resume.text,
            job,
            profile: store.getProfile(),
          });
          const needsApproval = (plan.newClaims?.length || 0) > 0;
          next.push({
            jobId: job.id,
            title: job.title,
            company: job.company,
            url: job.url,
            atsKind: ats.kind,
            atsLabel: ats.label,
            autoSubmit: ats.autoSubmit,
            status: needsApproval ? "needs_approval" : "approved",
            plan,
            approvedClaimIds: [],
            finalResume: plan.tailoredResume,
            at: Date.now(),
          });
        } catch (err: any) {
          next.push({
            jobId: job.id,
            title: job.title,
            company: job.company,
            url: job.url,
            atsKind: ats.kind,
            atsLabel: ats.label,
            autoSubmit: ats.autoSubmit,
            status: "failed",
            plan: null,
            approvedClaimIds: [],
            finalResume: "",
            error: err.message,
            at: Date.now(),
          });
        }
        saveQueue(next);
      }
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
          { resume: item.plan!.tailoredResume, approvedClaims, answers },
          () => {}
        );
      }
      const next = queue.map((q) =>
        q.jobId === item.jobId
          ? {
              ...q,
              status: "approved" as const,
              approvedClaimIds: approvedIds,
              finalResume: finalResume.trim(),
            }
          : q
      );
      saveQueue(next);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function removeItem(jobId: string) {
    saveQueue(queue.filter((q) => q.jobId !== jobId));
  }

  function markSubmitted(jobId: string) {
    saveQueue(
      queue.map((q) => (q.jobId === jobId ? { ...q, status: "submitted" as const } : q))
    );
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
      saveQueue(
        queue.map((q) =>
          q.status === "approved" ? { ...q, status: "exported" as const } : q
        )
      );
    } catch (err: any) {
      setError(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  const unqueued = jobs.filter((j) => !queue.some((q) => q.jobId === j.id));
  const counts = {
    needs: queue.filter((q) => q.status === "needs_approval").length,
    approved: queue.filter((q) => q.status === "approved").length,
    exported: queue.filter((q) => q.status === "exported").length,
    submitted: queue.filter((q) => q.status === "submitted").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Auto-Pilot</h1>
        <p className="muted mt-1">
          AI tailors your resume per job, asks you only when it would need to claim
          something new, then a local agent fills and submits the application directly on
          the company&apos;s official career site.
        </p>
      </div>

      {/* How it works */}
      <div className="grid sm:grid-cols-4 gap-3">
        {[
          { n: "1", t: "Tailor", d: "AI rewrites your resume for each job using only real experience." },
          { n: "2", t: "Approve", d: "If it needs a claim you haven't made, it asks you first." },
          { n: "3", t: "Export", d: "Download the queue — tailored PDFs and answers included." },
          { n: "4", t: "Auto-submit", d: "Local agent applies on Greenhouse / Lever / Ashby / Workable." },
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
        <b className="text-sky2-400">Official career sites only.</b> Greenhouse, Lever,
        Ashby and Workable forms are submitted automatically. LinkedIn / Naukri / Indeed
        are never bot-submitted — their terms forbid it and accounts get banned — so those
        stay in{" "}
        <Link href="/auto-apply" className="underline">
          Auto-Apply
        </Link>{" "}
        as one-click kits. Applying direct also beats portals: fewer applicants, and your
        application lands straight in the employer&apos;s ATS.
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      {progress && (
        <div className="text-sm text-neon-400 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3 animate-pulse">
          {progress}
        </div>
      )}

      {/* Queue jobs */}
      <div className="card-pad space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="h2">Pick jobs to auto-apply</h2>
          <button className="btn-primary" onClick={prepareSelected} disabled={busy}>
            {busy ? "Working…" : "✦ Tailor & queue selected"}
          </button>
        </div>
        {unqueued.length === 0 ? (
          <p className="text-sm text-ink-400">
            No new jobs.{" "}
            <Link href="/jobs" className="text-neon-400 underline">
              Find matches first →
            </Link>
          </p>
        ) : (
          unqueued.map((job) => {
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
                  <span
                    className={
                      ats.autoSubmit ? "badge-green" : ats.autoFill ? "badge-amber" : "badge-red"
                    }
                    title={ats.note}
                  >
                    {ats.autoSubmit ? "🤖 auto-submit" : ats.autoFill ? "✋ auto-fill" : "manual"}
                  </span>
                  <span className="badge-blue">{job.matchScore}%</span>
                </span>
              </label>
            );
          })
        )}
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="h2">
              Queue — {counts.needs} need you · {counts.approved} ready · {counts.exported}{" "}
              exported · {counts.submitted} submitted
            </h2>
            <button
              className="btn-primary"
              onClick={exportQueue}
              disabled={exporting || counts.approved === 0}
            >
              {exporting ? "Building PDFs…" : `⬇ Export ${counts.approved} for agent`}
            </button>
          </div>

          {queue
            .slice()
            .reverse()
            .map((item) => (
              <QueueCard
                key={item.jobId}
                item={item}
                busy={busy}
                onApprove={applyApprovals}
                onRemove={() => removeItem(item.jobId)}
                onSubmitted={() => markSubmitted(item.jobId)}
              />
            ))}
        </div>
      )}

      {/* Agent setup */}
      <div className="card-pad">
        <h2 className="h2 mb-3">Running the agent (one-time setup)</h2>
        <ol className="text-sm text-ink-300 space-y-2 list-decimal list-inside leading-relaxed">
          <li>
            In your project folder run:{" "}
            <code className="text-neon-400 text-xs">cd agent &amp;&amp; npm install</code>
          </li>
          <li>
            Move the downloaded <code className="text-xs">apply-queue.json</code> into the{" "}
            <code className="text-xs">agent/</code> folder.
          </li>
          <li>
            Dry run (fills, screenshots, submits nothing):{" "}
            <code className="text-neon-400 text-xs">npm run apply</code>
          </li>
          <li>
            When the screenshots look right, submit for real:{" "}
            <code className="text-neon-400 text-xs">npm run apply -- --submit</code>
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
}: {
  item: QueuedApplication;
  busy: boolean;
  onApprove: (item: QueuedApplication, ids: string[], answers: string) => void;
  onRemove: () => void;
  onSubmitted: () => void;
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
    approved: "✓ Ready to submit",
    exported: "Exported to agent",
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
          {item.autoSubmit && <span className="badge-green">🤖 auto-submit</span>}
        </div>
      </div>

      {item.error && <p className="text-xs text-coral-400 mt-2">{item.error}</p>}
      {item.plan && <p className="text-xs text-ink-300 mt-2 leading-relaxed">{item.plan.summary}</p>}

      <div className="flex gap-3 mt-3 flex-wrap">
        <button className="text-xs text-neon-400 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Hide details ▲" : "Review details ▼"}
        </button>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ink-400 hover:text-ink-200"
        >
          Open listing ↗
        </a>
        {(item.status === "exported" || item.status === "approved") && (
          <button className="text-xs text-neon-400 hover:underline" onClick={onSubmitted}>
            Mark submitted
          </button>
        )}
        <button className="text-xs text-coral-400 hover:underline" onClick={onRemove}>
          Remove
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
