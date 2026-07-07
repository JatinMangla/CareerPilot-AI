"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { store, defaultStats } from "@/lib/store";
import type { ResumeData, ValidationResult, UsageStats, Strategy } from "@/lib/types";

export default function Dashboard() {
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [stats, setStats] = useState<UsageStats>(defaultStats);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [appsCount, setAppsCount] = useState(0);
  const [jobsCount, setJobsCount] = useState(0);

  useEffect(() => {
    setResume(store.getResume());
    setValidation(store.getValidation());
    setStats(store.getStats());
    setStrategy(store.getStrategy());
    setAppsCount(store.getApps().length);
    setJobsCount(store.getJobs().length);
  }, []);

  const steps = [
    { done: !!resume, label: "Upload your resume", href: "/resume" },
    { done: !!validation, label: "Validate against industry standards", href: "/validate" },
    { done: jobsCount > 0, label: "Find matching jobs", href: "/jobs" },
    { done: appsCount > 0, label: "Prepare applications", href: "/auto-apply" },
    { done: stats.interviews > 0, label: "Do a mock interview", href: "/interview" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Welcome back, Jatin 👋</h1>
        <p className="muted mt-1">
          Your AI career copilot — resume, matching, applications, and interview prep in
          one place.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Resume score"
          value={validation ? `${validation.overallScore}/100` : "—"}
          sub={validation ? validation.verdict : "Not validated yet"}
          accent={validation && validation.overallScore >= 75 ? "green" : "amber"}
        />
        <StatCard
          label="Job matches"
          value={String(jobsCount)}
          sub="on Job Matches page"
          accent="blue"
        />
        <StatCard
          label="Applications prepared"
          value={String(appsCount)}
          sub="ready in Auto-Apply"
          accent="green"
        />
        <StatCard
          label="AI strategy"
          value={`v${strategy?.version ?? 1}`}
          sub="evolve to improve"
          accent="amber"
        />
      </div>

      {/* Getting started checklist */}
      <div className="card-pad">
        <h2 className="h2 mb-4">Your pipeline</h2>
        <div className="space-y-2.5">
          {steps.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-ink-800 transition group"
            >
              <span
                className={`grid place-items-center w-6 h-6 rounded-full text-xs font-bold ${
                  s.done
                    ? "bg-neon-500/20 text-neon-400 border border-neon-500/40"
                    : "bg-ink-800 text-ink-400 border border-ink-600"
                }`}
              >
                {s.done ? "✓" : "○"}
              </span>
              <span className={s.done ? "text-ink-300 line-through" : "text-ink-100"}>
                {s.label}
              </span>
              <span className="ml-auto text-ink-400 group-hover:text-neon-400 text-sm">
                →
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-pad">
          <h2 className="h2 mb-3">Activity</h2>
          <ul className="space-y-2 text-sm text-ink-300">
            <li>Resume improvements: <b className="text-ink-100">{stats.improvements}</b></li>
            <li>Validations run: <b className="text-ink-100">{stats.validations}</b></li>
            <li>Tailored versions: <b className="text-ink-100">{stats.tailors}</b></li>
            <li>Jobs analyzed: <b className="text-ink-100">{stats.jobsAnalyzed}</b></li>
            <li>Mock interviews: <b className="text-ink-100">{stats.interviews}</b></li>
            <li>Practice questions solved: <b className="text-ink-100">{stats.practiceSolved}</b></li>
          </ul>
        </div>
        <div className="card-pad">
          <h2 className="h2 mb-3">Honest by design</h2>
          <p className="text-sm text-ink-300 leading-relaxed">
            CareerPilot maximizes your odds — sharper resume, tailored applications,
            interview reps — but no tool can guarantee a job. Auto-Apply prepares
            everything per job (cover letter, answers, tailored bullets) and hands you
            one-click submission links, keeping your LinkedIn/Naukri accounts safe from
            bot bans.
          </p>
        </div>
      </div>
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
