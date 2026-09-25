"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask, streamTask } from "@/lib/aiClient";
import { describeClaims, newClaims } from "@/lib/claimCheck";
import type { TailorPlan, ResumeData } from "@/lib/types";
import CopyButton from "@/components/CopyButton";

type Stage = "input" | "review" | "result";

/** This device's in-progress plan, so leaving the page doesn't lose it. */
const DRAFT_KEY = "cp_tailor_draft";

export default function TailorPage() {
  const [jd, setJd] = useState("");
  const [plan, setPlan] = useState<TailorPlan | null>(null);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [stage, setStage] = useState<Stage>("input");
  const [output, setOutput] = useState("");
  /** Only a stream that finished may be saved; a stopped or cut-off one may not. */
  const [complete, setComplete] = useState(false);
  const [modelNote, setModelNote] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasResume, setHasResume] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  // Leaving the page ends the stream, instead of letting it run on unseen and
  // spend the day's free quota.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    setHasResume(!!store.getResume()?.text);
    // Pick up a plan in progress. It used to live only in React state, so
    // leaving the page threw away an AI plan and every answer typed into it.
    try {
      const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "null");
      if (saved?.plan) {
        setJd(saved.jd || "");
        setPlan(saved.plan);
        setAccepted(saved.accepted || {});
        setAnswers(saved.answers || {});
        setStage("review");
      } else if (saved?.jd) {
        setJd(saved.jd);
      }
    } catch {
      /* nothing to restore */
    }
  }, []);

  useEffect(() => {
    try {
      if (!jd && !plan) window.localStorage.removeItem(DRAFT_KEY);
      else window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ jd, plan, accepted, answers }));
    } catch {
      /* storage full — the page still works, it just won't resume */
    }
  }, [jd, plan, accepted, answers]);

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
        profile: store.getProfile(),
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
    setComplete(false);
    setModelNote("");
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
          profile: store.getProfile(),
          acceptedChanges,
          answers: answersText,
        },
        (full) => setOutput(full),
        {
          signal: abortRef.current.signal,
          onMeta: (m) =>
            setModelNote(
              m.fallback
                ? `Written by ${m.model} because the stronger model was busy — worth regenerating later for a sharper version.`
                : ""
            ),
        }
      );
      store.bumpStat("tailors");
      setOutput(final);
      setComplete(true);
      setClaimNote(describeClaims(newClaims(resume.text, final)));
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
          <label className="label" htmlFor="tailor-job-description">Job description</label>
          <textarea id="tailor-job-description"
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
                  <label className="label" htmlFor="tailor-field">{q}</label>
                  <input id="tailor-field"
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
                  // "Back" to edit the job description; the paid-for plan is only
                  // discarded when you make a new one or ask for it here.
                  if (!window.confirm("Discard this plan and start over?")) return;
                  setStage("input");
                  setPlan(null);
                }}
              >
                Start over
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
            <div className="flex gap-2 flex-wrap items-center">
              {!complete && output.trim() && (
                <p className="w-full text-xs text-amberx-400">
                  This version is incomplete (stopped or cut off), so it can&apos;t be saved. Apply the changes again.
                </p>
              )}
              {complete && modelNote && <p className="w-full text-xs text-ink-400">{modelNote}</p>}
              {complete && claimNote && (
                <p className="w-full text-xs text-amberx-400">
                  Not in your resume before: {claimNote}. Make sure each is true before saving.
                </p>
              )}
              <button className="btn-primary" onClick={saveTailored} disabled={!complete || !output.trim()}>
                ✓ Save as my resume
              </button>
              <button
                className="btn-secondary"
                disabled={!complete || !output.trim()}
                onClick={async () => {
                  const { buildResumePdf, downloadBlob } = await import("@/lib/pdf/resumeDoc");
                  const name = store.getProfile().name || "Resume";
                  const saved = window.localStorage.getItem("cp_pdf_template");
                  const tpl = saved === "modern" ? "modern" : "classic";
                  downloadBlob(
                    await buildResumePdf(output, name, tpl),
                    `${name.replace(/\s+/g, "_")}_Resume_Tailored.pdf`
                  );
                }}
              >
                ⬇ Download PDF
              </button>
              <CopyButton text={output} />
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
