"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { store, defaultStats } from "@/lib/store";
import { buildToday, type TodayItem } from "@/lib/today";
import { quota, type QuotaInfo } from "@/lib/quota";
import {
  breakdown,
  funnelOf,
  medianDaysToReply,
  resumeLabel,
  scoreBand,
  trackedApplications,
  type BreakdownRow,
} from "@/lib/outcomes";
import type { ResumeData, ValidationResult, UsageStats, Strategy } from "@/lib/types";

const TONE: Record<TodayItem["tone"], string> = {
  red: "bg-coral-500/15 text-coral-400",
  amber: "bg-amberx-500/15 text-amberx-400",
  blue: "bg-sky2-500/15 text-sky2-400",
  green: "bg-neon-500/15 text-neon-400",
};

export default function Dashboard() {
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [stats, setStats] = useState<UsageStats>(defaultStats);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [appsCount, setAppsCount] = useState(0);
  const [jobsCount, setJobsCount] = useState(0);
  const [quotas, setQuotas] = useState<QuotaInfo[]>([]);
  const [referralCount, setReferralCount] = useState(0);
  const [name, setName] = useState("");
  const [byChannel, setByChannel] = useState<BreakdownRow[]>([]);
  const [byScore, setByScore] = useState<BreakdownRow[]>([]);
  const [byResume, setByResume] = useState<BreakdownRow[]>([]);
  const [daysToReply, setDaysToReply] = useState<number | null>(null);
  const [today, setToday] = useState<TodayItem[]>([]);
  const [funnel, setFunnel] = useState({
    applied: 0,
    replied: 0,
    screen: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    replyRate: 0,
    interviewRate: 0,
  });

  useEffect(() => {
    setResume(store.getResume());
    setValidation(store.getValidation());
    setToday(
      buildToday({
        inbox: store.getInbox(),
        emails: store.getEmails(),
        queue: store.getQueue(),
        apps: store.getApps(),
        referrals: store.getReferrals(),
        jobs: store.getJobs(),
      })
    );
    setStats(store.getStats());
    setStrategy(store.getStrategy());
    setAppsCount(store.getApps().length + store.getQueue().length);
    setJobsCount(store.getJobs().length);
    setQuotas(quota.all());

    // Apply Kits and Auto-Pilot together — the funnel used to read only the first.
    const tracked = trackedApplications();
    setFunnel(funnelOf(tracked));
    setByChannel(breakdown(tracked, (a) => a.channel));
    setByScore(breakdown(tracked, scoreBand));
    setByResume(breakdown(tracked, resumeLabel));
    setDaysToReply(medianDaysToReply(tracked));
    setName(store.getProfile().name?.split(" ")[0] || "");
    setReferralCount(store.getReferrals().filter((r) => r.stage !== "planned").length);
  }, []);

  const steps = [
    { done: !!resume, label: "Upload your resume", href: "/resume" },
    { done: !!validation, label: "Validate against industry standards", href: "/validate" },
    { done: jobsCount > 0, label: "Find matching jobs", href: "/jobs" },
    { done: appsCount > 0, label: "Prepare applications", href: "/apply" },
    { done: stats.interviews > 0, label: "Do a mock interview", href: "/interview" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{name ? `Good to see you, ${name}` : "Today"}</h1>
        <p className="muted mt-1">
          {today.length
            ? "What moves your job search forward today, most urgent first."
            : "Nothing is waiting on you right now."}
        </p>
      </div>

      {/* What to do next. Totals say how much has happened; this says what to do. */}
      {today.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {today.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="card p-4 flex items-start gap-3.5 transition hover:border-ink-600 group"
            >
              <span
                className={`mt-0.5 grid place-items-center w-9 h-9 shrink-0 rounded-lg font-display font-bold text-sm ${TONE[item.tone]}`}
              >
                {item.count}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-100 group-hover:text-neon-400 transition">
                  {item.title}
                </span>
                <span className="block text-xs text-ink-400 mt-0.5 truncate">{item.detail}</span>
              </span>
              <span className="text-ink-500 group-hover:text-neon-400 transition" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}

      {/* Setup, shown only until it is done. */}
      {steps.some((s) => !s.done) && (
        <div className="card-pad">
          <h2 className="h2 mb-3">Get set up</h2>
          <div className="space-y-1">
            {steps.filter((s) => !s.done).map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-100 hover:bg-ink-800 transition group"
              >
                <span className="w-5 h-5 rounded-full border border-ink-600" aria-hidden="true" />
                {s.label}
                <span className="ml-auto text-ink-400 group-hover:text-neon-400" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Resume score"
          value={validation ? `${validation.overallScore}/100` : "—"}
          sub={
            !validation
              ? "Not validated yet"
              : resume && resume.updatedAt > validation.at
              ? "Resume changed since"
              : "From your last validation"
          }
          accent={validation && validation.overallScore >= 75 ? "green" : "amber"}
        />
        <StatCard label="Job matches" value={String(jobsCount)} sub="saved to apply to" accent="blue" />
        <StatCard label="Applications" value={String(appsCount)} sub="prepared so far" accent="green" />
        <StatCard
          label="Reply rate"
          value={funnel.applied ? `${funnel.replyRate.toFixed(0)}%` : "—"}
          sub={funnel.applied ? `of ${funnel.applied} sent` : "Nothing sent yet"}
          accent={funnel.replyRate >= 10 ? "green" : "amber"}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-pad md:col-span-2">
          <h2 className="h2 mb-1">Your funnel</h2>
          <p className="text-xs text-ink-400 mb-4">
            Benchmark: cold applications convert at 1–2%, referrals at ~30%. If the middle
            of this funnel is empty, applying more won&apos;t fix it — asking for referrals
            will.
          </p>
          {funnel.applied === 0 ? (
            <p className="text-sm text-ink-400">
              Nothing tracked yet. Mark applications as sent on the{" "}
              <Link href="/apply" className="text-neon-400 underline">
                Apply
              </Link>{" "}
              page, then record what happened.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
                {[
                  { k: "applied", label: "Applied", tone: "text-ink-100" },
                  { k: "replied", label: "Replied", tone: "text-sky2-400" },
                  { k: "screen", label: "Screen", tone: "text-sky2-400" },
                  { k: "interview", label: "Interview", tone: "text-amberx-400" },
                  { k: "offer", label: "Offer", tone: "text-neon-400" },
                  { k: "rejected", label: "Closed", tone: "text-coral-400" },
                ].map((s) => (
                  <div key={s.k}>
                    <div className={`font-display text-2xl font-bold ${s.tone}`}>
                      {(funnel as any)[s.k]}
                    </div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink-300 mt-4">
                Reply rate:{" "}
                <b className={funnel.replyRate >= 10 ? "text-neon-400" : "text-amberx-400"}>
                  {funnel.replyRate.toFixed(0)}%
                </b>{" "}
                · Interview rate:{" "}
                <b className={funnel.interviewRate >= 5 ? "text-neon-400" : "text-amberx-400"}>
                  {funnel.interviewRate.toFixed(0)}%
                </b>
                {referralCount > 0 && (
                  <>
                    {" "}
                    · <b className="text-neon-400">{referralCount}</b> referral ask
                    {referralCount === 1 ? "" : "s"} in flight
                  </>
                )}
                {daysToReply !== null && <> · first reply after ~{daysToReply} days</>}
              </p>
              {/* What is working, not just how much: the comparison that should
                  decide where the next week goes. */}
              <div className="grid md:grid-cols-3 gap-4 mt-5">
                <Breakdown title="By channel" rows={byChannel} />
                <Breakdown title="By match score" rows={byScore} />
                <Breakdown title="By resume version" rows={byResume} />
              </div>
            </>
          )}
        </div>

        <div className="card-pad">
          <h2 className="h2 mb-3">Free-tier usage</h2>
          <div className="space-y-4">
            {quotas.map((q) => {
              const pct = Math.min(100, Math.round((q.used / q.limit) * 100));
              const color =
                pct >= 100 ? "bg-coral-500" : pct >= q.warnAt * 100 ? "bg-amberx-500" : "bg-neon-500";
              return (
                <div key={q.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-ink-300">{q.label}</span>
                    <span className="text-ink-100 font-semibold">
                      {q.used}/{q.limit} per {q.period}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-ink-400 leading-relaxed">
              You&apos;ll get a warning banner as you approach a free limit. Past it, the AI
              starts answering &quot;rate-limited&quot; until the daily reset. No card is attached to these services, so{" "}
              <b className="text-ink-200">no bill can ever be generated</b> — usage simply
              resets next day/month.
            </p>
          </div>
        </div>
        <div className="card-pad">
          <h2 className="h2 mb-3">Activity</h2>
          <ul className="space-y-2 text-sm text-ink-300">
            <li>Resume improvements: <b className="text-ink-100">{stats.improvements}</b></li>
            <li>Validations run: <b className="text-ink-100">{stats.validations}</b></li>
            <li>Tailored versions: <b className="text-ink-100">{stats.tailors}</b></li>
            <li>Jobs analyzed: <b className="text-ink-100">{stats.jobsAnalyzed}</b></li>
            <li>Mock interviews: <b className="text-ink-100">{stats.interviews}</b></li>
            <li>Practice questions solved: <b className="text-ink-100">{stats.practiceSolved}</b></li>
            <li>AI strategy: <b className="text-ink-100">v{strategy?.version ?? 1}</b></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-2">{title}</h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-ink-500 text-left">
            <th className="font-normal pb-1"></th>
            <th className="font-normal pb-1 text-right">Sent</th>
            <th className="font-normal pb-1 text-right">Replies</th>
            <th className="font-normal pb-1 text-right">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="text-ink-300">
              <td className="py-0.5 pr-2">{r.label}</td>
              <td className="py-0.5 text-right">{r.applied}</td>
              <td className="py-0.5 text-right">{r.replied}</td>
              <td className={`py-0.5 text-right font-semibold ${r.replyRate >= 10 ? "text-neon-400" : "text-ink-200"}`}>
                {r.replyRate.toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "green" | "amber" | "blue";
}) {
  const color =
    accent === "green"
      ? "text-neon-400"
      : accent === "amber"
      ? "text-amberx-400"
      : "text-sky2-400";
  return (
    <div className="card-pad">
      <div className="text-xs uppercase tracking-wider text-ink-400 font-semibold">
        {label}
      </div>
      <div className={`font-display text-3xl font-bold mt-1.5 ${color}`}>{value}</div>
      <div className="text-xs text-ink-400 mt-1">{sub}</div>
    </div>
  );
}
