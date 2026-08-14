"use client";

import { useState } from "react";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { PracticeQuestion, SolutionReview } from "@/lib/types";

const TOPICS = [
  "JavaScript arrays & strings",
  "JavaScript closures & scope",
  "Promises & async",
  "React logic (hooks, state)",
  "DOM & events",
  "Data structures (stack/queue/map)",
  "Algorithms (two pointers, sliding window)",
];

export default function PracticePage() {
  const [topic, setTopic] = useState(TOPICS[0]);
  const [difficulty, setDifficulty] = useState<"Easy" | "Medium" | "Hard">("Medium");
  const [format, setFormat] = useState<"component" | "algorithm">("component");
  const [q, setQ] = useState<PracticeQuestion | null>(null);
  const [code, setCode] = useState("");
  const [review, setReview] = useState<SolutionReview | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "question" | "review">("");
  const [error, setError] = useState("");
  const [showOptimal, setShowOptimal] = useState(false);

  async function newQuestion() {
    setError("");
    setBusy("question");
    setReview(null);
    setHintsShown(0);
    setShowOptimal(false);
    try {
      const question = await jsonTask<PracticeQuestion>("practice_question", {
        topic,
        difficulty,
        format,
        seen: seen.join(", "),
      });
      setQ(question);
      setSeen((s) => [...s, question.title].slice(-20));
      setCode(question.starterCode);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    if (!q || !code.trim()) return;
    setError("");
    setBusy("review");
    setShowOptimal(false);
    try {
      const r = await jsonTask<SolutionReview>("review_solution", { question: q, code });
      setReview(r);
      if (r.verdict === "Accepted") store.bumpStat("practiceSolved");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Practice Arena</h1>
        <p className="muted mt-1">
          Interview-style coding questions for frontend developers — solve, submit, get
          judged like a real interview.
        </p>
      </div>

      <div className="card-pad flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Topic</label>
          <select className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>
            {TOPICS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Difficulty</label>
          <select
            className="input"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as any)}
          >
            <option>Easy</option>
            <option>Medium</option>
            <option>Hard</option>
          </select>
        </div>
        <button className="btn-primary" onClick={newQuestion} disabled={busy === "question"}>
          {busy === "question" ? "Generating…" : q ? "Next question" : "{} Get a question"}
        </button>
        <div className="w-full flex items-center gap-2 pt-1">
          <span className="text-xs text-ink-400">Format:</span>
          {([
            { k: "component", label: "🧩 Build a component" },
            { k: "algorithm", label: "🔢 Algorithm" },
          ] as const).map((o) => (
            <button
              key={o.k}
              onClick={() => setFormat(o.k)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition ${
                format === o.k
                  ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                  : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-ink-300 bg-sky2-500/10 border border-sky2-500/25 rounded-xl px-4 py-3 leading-relaxed">
        <b className="text-sky2-400">Practise what they actually ask.</b> Frontend loops are
        mostly a 45–60 minute pair-programming round — fetch an API and render a filterable
        list, handle loading and error states, debounce a search. Algorithm puzzles are a
        smaller part of the loop for this role, so component format is the default.
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {q && (
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Question */}
          <div className="card-pad space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="h2">{q.title}</h2>
              <div className="flex gap-2">
                <span
                  className={
                    q.difficulty === "Easy"
                      ? "badge-green"
                      : q.difficulty === "Hard"
                      ? "badge-red"
                      : "badge-amber"
                  }
                >
                  {q.difficulty}
                </span>
                <span className="badge-blue">{q.topic}</span>
              </div>
            </div>
            <p className="text-sm text-ink-200 leading-relaxed whitespace-pre-wrap">
              {q.description}
            </p>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-300 mb-2">
                Examples
              </h3>
              <div className="space-y-1.5">
                {q.examples.map((ex, i) => (
                  <p key={i} className="font-mono text-xs text-ink-300 bg-ink-850 rounded-lg px-3 py-2">
                    {ex}
                  </p>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink-300">
                  Hints
                </h3>
                {hintsShown < q.hints.length && (
                  <button
                    className="text-xs text-amberx-400 hover:underline"
                    onClick={() => setHintsShown(hintsShown + 1)}
                  >
                    Reveal hint {hintsShown + 1}/{q.hints.length}
                  </button>
                )}
              </div>
              <div className="space-y-1.5 mt-2">
                {q.hints.slice(0, hintsShown).map((h, i) => (
                  <p key={i} className="text-xs text-amberx-400/90 bg-amberx-500/10 rounded-lg px-3 py-2">
                    💡 {h}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {/* Solution editor */}
          <div className="card-pad space-y-4">
            <h2 className="h2">Your solution</h2>
            <textarea
              className="input font-mono text-[13px] leading-relaxed min-h-[320px] resize-y"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
            />
            <button className="btn-primary" onClick={submit} disabled={busy === "review"}>
              {busy === "review" ? "Judging…" : "Submit solution"}
            </button>

            {review && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span
                    className={
                      review.verdict === "Accepted"
                        ? "badge-green"
                        : review.verdict === "Partially Correct"
                        ? "badge-amber"
                        : "badge-red"
                    }
                  >
                    {review.verdict}
                  </span>
                  <span className="font-display font-bold text-ink-100">
                    {review.score}/100
                  </span>
                  <span className="text-xs text-ink-400">{review.complexity}</span>
                </div>
                <p className="text-sm text-ink-200 leading-relaxed whitespace-pre-wrap">
                  {review.feedback}
                </p>
                <button
                  className="btn-secondary text-xs"
                  onClick={() => setShowOptimal(!showOptimal)}
                >
                  {showOptimal ? "Hide optimal solution" : "Show optimal solution"}
                </button>
                {showOptimal && (
                  <pre className="prose-out card p-4 overflow-auto">
                    {review.optimalSolution}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
