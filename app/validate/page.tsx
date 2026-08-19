"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { ImprovementBrief, ValidationResult } from "@/lib/types";

/** A category below this is worth telling the AI to prioritise. */
const WEAK_BELOW = 70;

export default function ValidatePage() {
  const router = useRouter();
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [hasResume, setHasResume] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* Which findings get carried over to "Improve with AI". */
  const [points, setPoints] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [includeWeak, setIncludeWeak] = useState(true);

  useEffect(() => {
    const saved = store.getValidation();
    if (saved) adopt(saved);
    setHasResume(!!store.getResume()?.text);
  }, []);

  /** Show a result and pre-select every finding — opting out is the rare case. */
  function adopt(r: ValidationResult) {
    setResult(r);
    setPoints(r.improvements);
    setKeywords(r.missingKeywords);
    setIncludeWeak(true);
  }

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
      adopt(full);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const weakAreas = (result?.categories || []).filter((c) => c.score < WEAK_BELOW);
  const carried = points.length + keywords.length + (includeWeak ? weakAreas.length : 0);

  function sendToImprove() {
    if (!result) return;
    const brief: ImprovementBrief = {
      points,
      keywords,
      weakAreas: includeWeak ? weakAreas : [],
      at: result.at,
    };
    store.setBrief(brief);
    router.push("/resume");
  }

  function toggle(list: string[], setList: (v: string[]) => void, item: string) {
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="h1">Validate Resume</h1>
          <p className="muted mt-1">
            Strict scoring against industry standards & ATS best practices — then send
            every fix straight to the AI.
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
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <h2 className="h2">Category breakdown</h2>
              {weakAreas.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-ink-300 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-neon-500"
                    checked={includeWeak}
                    onChange={(e) => setIncludeWeak(e.target.checked)}
                  />
                  Send the {weakAreas.length} weak{" "}
                  {weakAreas.length === 1 ? "category" : "categories"} to the AI
                </label>
              )}
            </div>
            <div className="space-y-4">
              {result.categories.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-semibold text-ink-100">
                      {c.name}
                      {includeWeak && c.score < WEAK_BELOW && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-neon-400">
                          → AI
                        </span>
                      )}
                    </span>
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
            <ListCard
              title="Improvements"
              items={result.improvements}
              tone="amber"
              selected={points}
              onToggle={(it) => toggle(points, setPoints, it)}
            />
            <ListCard
              title="Missing keywords"
              items={result.missingKeywords}
              tone="red"
              selected={keywords}
              onToggle={(it) => toggle(keywords, setKeywords, it)}
            />
          </div>

          <div className="card-pad flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-ink-200">
                {carried > 0
                  ? `${carried} fix${carried === 1 ? "" : "es"} ready to send`
                  : "Nothing selected"}
              </p>
              <p className="text-xs text-ink-400 mt-1">
                {carried > 0
                  ? "These become the instructions on My Resume → Improve with AI. Untick anything you disagree with."
                  : "Tick at least one improvement or keyword above to build the AI brief."}
              </p>
            </div>
            <button className="btn-primary" onClick={sendToImprove} disabled={carried === 0}>
              ✦ Fix these with AI →
            </button>
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

/**
 * A plain list, or — when `onToggle` is supplied — a pick-list of findings to
 * hand to the AI.
 */
function ListCard({
  title,
  items,
  tone,
  selected,
  onToggle,
}: {
  title: string;
  items: string[];
  tone: "green" | "amber" | "red";
  selected?: string[];
  onToggle?: (item: string) => void;
}) {
  const dot =
    tone === "green" ? "text-neon-400" : tone === "amber" ? "text-amberx-400" : "text-coral-400";
  return (
    <div className="card-pad">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="font-display font-bold text-sm">{title}</h3>
        {onToggle && items.length > 0 && (
          <span className="text-[10px] text-ink-400">
            {selected!.length}/{items.length} → AI
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {items.map((it, i) =>
          onToggle ? (
            <li key={i}>
              <label className="flex gap-2 text-xs text-ink-300 leading-relaxed cursor-pointer hover:text-ink-100">
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0 accent-neon-500"
                  checked={selected!.includes(it)}
                  onChange={() => onToggle(it)}
                />
                {it}
              </label>
            </li>
          ) : (
            <li key={i} className="flex gap-2 text-xs text-ink-300 leading-relaxed">
              <span className={dot}>●</span>
              {it}
            </li>
          )
        )}
        {items.length === 0 && <li className="text-xs text-ink-400">None found.</li>}
      </ul>
    </div>
  );
}
