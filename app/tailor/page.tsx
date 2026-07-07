"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask, streamTask } from "@/lib/aiClient";
import type { TailorPlan, ResumeData } from "@/lib/types";

type Stage = "input" | "review" | "result";

export default function TailorPage() {
  const [jd, setJd] = useState("");
  const [plan, setPlan] = useState<TailorPlan | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [stage, setStage] = useState<Stage>("input");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasResume, setHasResume] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setHasResume(!!store.getResume()?.text);
  }, []);

  async function makePlan() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first on the My Resume page.");
    if (!jd.trim()) return setError("Paste the job description first.");
    setError("");
    setBusy(true);
    try {
      const p = await jsonTask<TailorPlan>("tailor_plan", {
        resume: resume.text,
        jobDescription: jd,
      });
      setPlan(p);
      setAccepted(Object.fromEntries(p.changes.map((c) => [c.id, true])));
      setAnswers({});
      setStage("review");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyPlan() {
    const resume = store.getResume()!;
    const acceptedChanges = plan!.changes.filter((c) => accepted[c.id]);
    if (acceptedChanges.length === 0)
      return setError("You rejected every change — nothing to apply.");
    setError("");
    setBusy(true);
    setOutput("");
    setStage("result");
    abortRef.current = new AbortController();
    try {
      const answersText = plan!.questions
        .map((q, i) => `Q: ${q}\nA: ${answers[i] || "(not answered — use your best judgment, don't invent specifics)"}`)
        .join("\n\n");
      const final = await streamTask(
        "apply_tailor",
        {
          resume: resume.text,
          jobDescription: jd,
          acceptedChanges,
          answers: answersText,
        },
        (full) => setOutput(full),
        abortRef.current.signal
      );
      store.bumpStat("tailors");
      void final;
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function saveTailored() {
    const prev = store.getResume();
    const data: ResumeData = {
      text: output.trim(),
      fileName: prev?.fileName,
      updatedAt: Date.now(),
      versions: [
        ...(prev?.versions || []),
        ...(prev?.text ? [{ text: prev.text, label: "Before: tailoring", at: prev.updatedAt }] : []),
      ].slice(-15),
    };
    store.setResume(data);
    setStage("input");
    setPlan(null);
    setOutput("");
    setJd("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Tailor to a Job</h1>
        <p className="muted mt-1">
          Paste a job description. The AI proposes changes and{" "}
          <b className="text-ink-100">asks for your approval</b> before touching your
          resume.
        </p>
      </div>

      {!hasResume && (
        <div className="card-pad text-sm text-ink-300">
          No resume yet —{" "}
          <Link href="/resume" className="text-neon-400 underline">
            add one first
          </Link>
          .
        </div>
      )}

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {stage === "input" && (
        <div className="card-pad space-y-4">
          <label className="label">Job description</label>
          <textarea
            className="input min-h-[280px] resize-y"
            placeholder="Paste the full job description here…"
            value={jd}
            onChange={(e) => setJd(e.target.value)}
          />
          <button className="btn-primary" onClick={makePlan} disabled={busy || !hasResume}>
            {busy ? "Analyzing job…" : "✂ Propose tailoring plan"}
          </button>
        </div>
      )}

      {stage === "review" && plan && (
        <>
          <div className="card-pad">
            <h2 className="h2 mb-2">Fit & strategy</h2>
            <p className="text-sm text-ink-200">{plan.summary}</p>
          </div>

          {plan.questions.length > 0 && (
            <div className="card-pad space-y-4">
              <h2 className="h2">The AI needs to ask you first</h2>
              {plan.questions.map((q, i) => (
                <div key={i}>
                  <label className="label">{q}</label>
                  <input
                    className="input"
                    placeholder="Your answer (leave empty to skip)"
                    value={answers[i] || ""}
                    onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="card-pad space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="h2">
                Proposed changes ({plan.changes.filter((c) => accepted[c.id]).length}/
                {plan.changes.length} approved)
              </h2>
              <div className="flex gap-2">
                <button
                  className="btn-secondary text-xs"
                  onClick={() =>
                    setAccepted(Object.fromEntries(plan.changes.map((c) => [c.id, true])))
                  }
                >
                  Approve all
                </button>
                <button
                  className="btn-secondary text-xs"
                  onClick={() =>
                    setAccepted(Object.fromEntries(plan.changes.map((c) => [c.id, false])))
                  }
                >
                  Reject all
                </button>
              </div>
            </div>

            {plan.changes.map((c) => (
              <div
                key={c.id}
                className={`rounded-xl border p-4 transition ${
                  accepted[c.id]
                    ? "border-neon-500/30 bg-neon-500/5"
                    : "border-ink-700 bg-ink-850 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="badge-blue">{c.section}</span>
                  <button
                    className={accepted[c.id] ? "btn-danger text-xs px-3 py-1.5" : "btn-primary text-xs px-3 py-1.5"}
                    onClick={() => setAccepted({ ...accepted, [c.id]: !accepted[c.id] })}
                  >
                    {accepted[c.id] ? "Reject" : "Approve"}
                  </button>
                </div>
                {c.current !== "NEW" && (
                  <p className="text-xs text-coral-400/90 mt-3 line-through leading-relaxed">
                    {c.current}
                  </p>
                )}
                <p className="text-sm text-neon-400 mt-1.5 leading-relaxed">{c.proposed}</p>
                <p className="text-xs text-ink-400 mt-2 italic">Why: {c.reason}</p>
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <button className="btn-primary" onClick={applyPlan} disabled={busy}>
                ✓ Apply approved changes
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setStage("input");
                  setPlan(null);
                }}
              >
                Back
              </button>
            </div>
          </div>
        </>
      )}

      {stage === "result" && (
        <div className="card-pad space-y-4">
          <h2 className="h2">{busy ? "Tailoring your resume…" : "Tailored resume"}</h2>
          <div className="prose-out card p-4 max-h-[520px] overflow-auto min-h-[120px]">
            {output || "…"}
          </div>
          {busy ? (
            <button className="btn-danger" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary" onClick={saveTailored} disabled={!output.trim()}>
                ✓ Save as my resume
              </button>
              <button
                className="btn-secondary"
                onClick={() => navigator.clipboard.writeText(output)}
              >
                Copy
              </button>
              <button className="btn-secondary" onClick={() => setStage("review")}>
                Back to plan
              </button>
            </div>
          )}
          {!busy && (
            <p className="text-xs text-ink-400">
              Saving keeps your previous resume in version history on the My Resume page.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
