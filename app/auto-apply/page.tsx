"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { Job, PreparedApplication, Profile } from "@/lib/types";

const ALL_PORTALS = ["LinkedIn", "Naukri", "Indeed", "Wellfound", "Instahyre", "Cutshort"];

function portalSearchUrl(portal: string, job: Job): string {
  const q = encodeURIComponent(`${job.title} ${job.company}`);
  switch (portal) {
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

export default function AutoApplyPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [apps, setApps] = useState<PreparedApplication[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
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
    const targets = jobs.filter((j) => selected[j.id] && !apps.some((a) => a.jobId === j.id));
    if (targets.length === 0) return setError("Select at least one job (not already prepared).");
    setError("");
    setBusy(true);
    const portal = profile?.portals[0] || "LinkedIn";
    const next = [...apps];
    try {
      for (let i = 0; i < targets.length; i++) {
        const job = targets[i];
        setProgress(`Preparing ${i + 1}/${targets.length}: ${job.title} @ ${job.company}…`);
        const prep = await jsonTask<{
          coverLetter: string;
          tailoredHighlights: string[];
          screeningAnswers: { question: string; answer: string }[];
        }>("prepare_application", { resume: resume.text, job, portal });
        next.push({
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
        store.setApps(next);
        store.bumpStat("applicationsPrepared");
        setApps([...next]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function markApplied(jobId: string) {
    const next = apps.map((a) =>
      a.jobId === jobId ? { ...a, status: "applied" as const } : a
    );
    store.setApps(next);
    setApps(next);
  }

  function removeApp(jobId: string) {
    const next = apps.filter((a) => a.jobId !== jobId);
    store.setApps(next);
    setApps(next);
  }

  const unprepared = jobs.filter((j) => !apps.some((a) => a.jobId === j.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Auto-Apply Pipeline</h1>
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
          <h2 className="h2">Queue jobs</h2>
          <button className="btn-primary" onClick={prepareSelected} disabled={busy}>
            {busy ? "Preparing…" : "➤ Prepare selected applications"}
          </button>
        </div>
        {progress && <p className="text-sm text-neon-400 animate-pulse">{progress}</p>}
        {unprepared.length === 0 && (
          <p className="text-sm text-ink-400">
            No unprepared jobs in your list.{" "}
            <Link href="/jobs" className="text-neon-400 underline">
              Find matches first →
            </Link>
          </p>
        )}
        {unprepared.map((job) => (
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
            <span className="ml-auto badge-green">{job.matchScore}%</span>
          </label>
        ))}
      </div>

      {/* Prepared applications */}
      {apps.length > 0 && (
        <div className="space-y-4">
          <h2 className="h2">
            Prepared applications ({apps.filter((a) => a.status === "applied").length}{" "}
            applied / {apps.length})
          </h2>
          {apps
            .slice()
            .reverse()
            .map((app) => (
              <AppCard
                key={app.jobId}
                app={app}
                portals={profile?.portals || []}
                job={jobs.find((j) => j.id === app.jobId)}
                onApplied={() => markApplied(app.jobId)}
                onRemove={() => removeApp(app.jobId)}
              />
            ))}
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
  onRemove,
}: {
  app: PreparedApplication;
  portals: string[];
  job?: Job;
  onApplied: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
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
        {app.url && (
          <a href={app.url} target="_blank" rel="noreferrer" className="btn-secondary text-xs px-3 py-1.5">
            Direct listing ↗
          </a>
        )}
        {app.status !== "applied" && (
          <button className="btn-primary text-xs px-3 py-1.5" onClick={onApplied}>
            Mark as applied
          </button>
        )}
        <button className="btn-danger text-xs px-3 py-1.5" onClick={onRemove}>
          Remove
        </button>
      </div>

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
                  {copied === "cover" ? "Copied ✓" : "Copy"}
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
                {copied === "bullets" ? "Copied ✓" : "Copy all"}
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
                      {copied === `qa${i}` ? "✓" : "Copy"}
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
