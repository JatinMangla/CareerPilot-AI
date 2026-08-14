"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { Job, ReferralPlan, ReferralRecord, ReferralStage } from "@/lib/types";

const STAGES: { key: ReferralStage; label: string; tone: string }[] = [
  { key: "planned", label: "Planned", tone: "badge-blue" },
  { key: "asked", label: "Asked", tone: "badge-amber" },
  { key: "accepted", label: "Connected", tone: "badge-amber" },
  { key: "referred", label: "✓ Referred", tone: "badge-green" },
  { key: "declined", label: "Declined", tone: "badge-red" },
];

export default function ReferralsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [records, setRecords] = useState<ReferralRecord[]>([]);
  const [busyJob, setBusyJob] = useState("");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setJobs(store.getJobs());
    setRecords(store.getReferrals());
  }, []);

  function save(next: ReferralRecord[]) {
    store.setReferrals(next);
    setRecords([...next]);
  }

  async function planFor(job: Job) {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — the ask is built from it.");
    setError("");
    setBusyJob(job.id);
    try {
      const plan = await jsonTask<ReferralPlan>("referral_plan", {
        job,
        resume: resume.text,
        profile: store.getProfile(),
      });
      const rec: ReferralRecord = {
        id: `${Date.now()}`,
        jobId: job.id,
        jobTitle: job.title,
        company: job.company,
        stage: "planned",
        plan,
        at: Date.now(),
        updatedAt: Date.now(),
      };
      const next = [...store.getReferrals(), rec];
      save(next);
      setOpenId(rec.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyJob("");
    }
  }

  function setStage(id: string, stage: ReferralStage) {
    save(
      store.getReferrals().map((r) =>
        r.id === id ? { ...r, stage, updatedAt: Date.now() } : r
      )
    );
  }

  function remove(id: string) {
    save(store.getReferrals().filter((r) => r.id !== id));
  }

  function emailIt(rec: ReferralRecord) {
    store.setDraft({
      mode: "new",
      to: "",
      role: rec.jobTitle,
      company: rec.company,
      context:
        `I'm asking for a referral (not applying cold) to ${rec.jobTitle} at ${rec.company}. ` +
        `Use this as the basis and keep it short and forwardable:\n\n${rec.plan.coldEmail.body}`,
    });
    router.push("/outreach");
  }

  const withoutPlan = jobs.filter((j) => !records.some((r) => r.jobId === j.id));
  const referred = records.filter((r) => r.stage === "referred").length;
  const asked = records.filter((r) => r.stage !== "planned").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Referrals</h1>
        <p className="muted mt-1">
          The channel that actually works. Referred candidates reach interview at roughly{" "}
          <b className="text-neon-400">30%</b> versus{" "}
          <b className="text-coral-400">1–2%</b> for a cold application — and referrals are
          about 7% of applicants but 30–50% of hires.
        </p>
      </div>

      <div className="text-xs text-ink-300 bg-sky2-500/10 border border-sky2-500/25 rounded-xl px-4 py-3 leading-relaxed">
        <b className="text-sky2-400">What this does and doesn&apos;t do.</b> It writes the ask
        and tells you exactly who to look for — it can&apos;t find people for you, because
        scraping LinkedIn violates their terms and risks your account. You do the searching
        (30 seconds with the queries below); the AI does the writing.
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {records.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Referral asks" value={String(records.length)} tone="text-sky2-400" />
          <Stat label="Sent" value={String(asked)} tone="text-amberx-400" />
          <Stat label="Referred" value={String(referred)} tone="text-neon-400" />
        </div>
      )}

      {/* Pick a job */}
      <div className="card-pad space-y-3">
        <h2 className="h2">Plan a referral</h2>
        {withoutPlan.length === 0 ? (
          <p className="text-sm text-ink-400">
            {jobs.length === 0 ? (
              <>
                No jobs yet —{" "}
                <Link href="/jobs" className="text-neon-400 underline">
                  find matches first
                </Link>
                .
              </>
            ) : (
              "Every job in your list already has a referral plan."
            )}
          </p>
        ) : (
          withoutPlan.slice(0, 12).map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-ink-850"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-100 truncate">{job.title}</p>
                <p className="text-xs text-ink-400">
                  {job.company} · {job.matchScore}% match
                </p>
              </div>
              <button
                className="btn-primary text-xs px-3 py-1.5 shrink-0"
                onClick={() => planFor(job)}
                disabled={!!busyJob}
              >
                {busyJob === job.id ? "Writing…" : "Plan ask"}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Plans */}
      {records
        .slice()
        .reverse()
        .map((rec) => {
          const open = openId === rec.id;
          const stage = STAGES.find((s) => s.key === rec.stage)!;
          return (
            <div key={rec.id} className="card p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-display font-bold text-ink-100">{rec.jobTitle}</h3>
                  <p className="text-sm text-ink-300">{rec.company}</p>
                </div>
                <span className={stage.tone}>{stage.label}</span>
              </div>

              <p className="text-xs text-ink-400 mt-2 italic">{rec.plan.risk}</p>

              <div className="flex gap-2 mt-3 flex-wrap">
                {STAGES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setStage(rec.id, s.key)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold border transition ${
                      rec.stage === s.key
                        ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                        : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-3 mt-3 flex-wrap text-xs">
                <button
                  className="text-neon-400 hover:underline"
                  onClick={() => setOpenId(open ? null : rec.id)}
                >
                  {open ? "Hide messages ▲" : "Show messages ▼"}
                </button>
                <button className="text-neon-400 hover:underline" onClick={() => emailIt(rec)}>
                  ✉ Send as email
                </button>
                <button className="text-coral-400 hover:underline" onClick={() => remove(rec.id)}>
                  Remove
                </button>
              </div>

              {open && (
                <div className="mt-4 space-y-4">
                  <Block title="Who to ask">
                    <ul className="space-y-1.5">
                      {rec.plan.whoToAsk.map((w, i) => (
                        <li key={i} className="text-xs text-ink-300 flex gap-2">
                          <span className="text-neon-400">{i + 1}.</span> {w}
                        </li>
                      ))}
                    </ul>
                  </Block>

                  <Block title="Search for them">
                    <div className="space-y-1.5">
                      {rec.plan.searchQueries.map((q, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <code className="flex-1 text-[11px] text-ink-200 bg-ink-900 rounded px-2 py-1.5 break-all">
                            {q}
                          </code>
                          <a
                            href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-neon-400 hover:underline shrink-0"
                          >
                            search ↗
                          </a>
                        </div>
                      ))}
                    </div>
                  </Block>

                  <Copyable
                    title={`LinkedIn connection note (${rec.plan.connectionNote.length}/300)`}
                    text={rec.plan.connectionNote}
                  />
                  <Copyable title="Referral message (after they accept)" text={rec.plan.referralMessage} />
                  <Copyable
                    title={`Cold email — ${rec.plan.coldEmail.subject}`}
                    text={rec.plan.coldEmail.body}
                  />
                  <Copyable
                    title="Bullets for their internal referral form"
                    text={rec.plan.whyMeBullets.map((b) => `• ${b}`).join("\n")}
                  />
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="card-pad">
      <div className="text-xs uppercase tracking-wider text-ink-400 font-semibold">{label}</div>
      <div className={`font-display text-3xl font-bold mt-1.5 ${tone}`}>{value}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-ink-300 mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Copyable({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-ink-300">{title}</h4>
        <button
          className="text-xs text-neon-400 hover:underline shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-ink-200 leading-relaxed bg-ink-850 rounded-xl p-3 whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}
