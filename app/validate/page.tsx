"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { ValidationResult } from "@/lib/types";

export default function ValidatePage() {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [hasResume, setHasResume] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setResult(store.getValidation());
    setHasResume(!!store.getResume()?.text);
  }, []);

  async function run() {
    const resume = store.getResume();
    if (!resume?.text) {
      setError("No resume found — add one on the My Resume page first.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const data = await jsonTask<Omit<ValidationResult, "at">>("validate_resume", {
        resume: resume.text,
      });
      const full: ValidationResult = { ...data, at: Date.now() };
      store.setValidation(full);
      store.bumpStat("validations");
      setResult(full);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="h1">Validate Resume</h1>
          <p className="muted mt-1">
            Strict scoring against industry standards & ATS best practices.
          </p>
        </div>
        <button className="btn-primary" onClick={run} disabled={busy || !hasResume}>
          {busy ? "Analyzing…" : result ? "Re-validate" : "✓ Validate now"}
        </button>
      </div>

      {!hasResume && (
        <div className="card-pad text-sm text-ink-300">
          No resume yet.{" "}
          <Link href="/resume" className="text-neon-400 underline">
            Add your resume
          </Link>{" "}
          first.
        </div>
      )}

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {busy && (
        <div className="card-pad text-sm text-ink-300 animate-pulse">
          Running deep analysis — structure, keywords, impact, ATS compatibility…
        </div>
      )}

      {result && !busy && (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            <ScoreRing label="Overall score" score={result.overallScore} />
            <ScoreRing label="ATS compatibility" score={result.atsScore} />
          </div>

          <div className="card-pad">
            <h2 className="h2 mb-1">Verdict</h2>
            <p className="text-sm text-ink-200">{result.verdict}</p>
            <p className="text-[11px] text-ink-400 mt-2">
              Validated {new Date(result.at).toLocaleString()}
            </p>
          </div>

          <div className="card-pad">
            <h2 className="h2 mb-4">Category breakdown</h2>
            <div className="space-y-4">
              {result.categories.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-semibold text-ink-100">{c.name}</span>
                    <span className={scoreColor(c.score)}>{c.score}/100</span>
                  </div>
                  <div className="h-2 rounded-full bg-ink-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor(c.score)}`}
                      style={{ width: `${c.score}%` }}
                    />
                  </div>
                  <p className="text-xs text-ink-300 mt-1.5">{c.feedback}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <ListCard title="Strengths" items={result.strengths} tone="green" />
            <ListCard title="Improvements" items={result.improvements} tone="amber" />
            <ListCard title="Missing keywords" items={result.missingKeywords} tone="red" />
          </div>

          <div className="card-pad flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-ink-300">
              Want the AI to fix these issues automatically?
            </p>
            <Link href="/resume" className="btn-primary">
              ✦ Improve my resume →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function scoreColor(s: number) {
  return s >= 75 ? "text-neon-400" : s >= 55 ? "text-amberx-400" : "text-coral-400";
}
function barColor(s: number) {
  return s >= 75 ? "bg-neon-500" : s >= 55 ? "bg-amberx-500" : "bg-coral-500";
}

function ScoreRing({ label, score }: { label: string; score: number }) {
  const angle = Math.max(0, Math.min(100, score)) * 3.6;
  const ring =
    score >= 75 ? "#17c996" : score >= 55 ? "#f5a623" : "#f4553f";
  return (
    <div className="card-pad flex items-center gap-5">
      <div
        className="grid place-items-center w-24 h-24 rounded-full shrink-0"
        style={{
          background: `conic-gradient(${ring} ${angle}deg, #233049 ${angle}deg)`,
        }}
      >
        <div className="grid place-items-center w-[76px] h-[76px] rounded-full bg-ink-900">
          <span className="font-display text-2xl font-bold" style={{ color: ring }}>
            {score}
          </span>
        </div>
      </div>
      <div>
        <div className="font-semibold text-ink-100">{label}</div>
        <div className="text-xs text-ink-400 mt-1">
          {score >= 75 ? "Strong" : score >= 55 ? "Decent — improvable" : "Needs work"}
        </div>
      </div>
    </div>
  );
}

function ListCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "green" | "amber" | "red";
}) {
  const dot =
    tone === "green" ? "text-neon-400" : tone === "amber" ? "text-amberx-400" : "text-coral-400";
  return (
    <div className="card-pad">
      <h3 className="font-display font-bold text-sm mb-3">{title}</h3>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-xs text-ink-300 leading-relaxed">
            <span className={dot}>●</span>
            {it}
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-ink-400">None found.</li>}
      </ul>
    </div>
  );
}
