"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { streamTask } from "@/lib/aiClient";
import type { ImprovementBrief, ResumeData } from "@/lib/types";

/** How many individual fixes a brief carries. */
function briefCount(b: ImprovementBrief | null): number {
  if (!b) return 0;
  return b.points.length + b.keywords.length + b.weakAreas.length;
}

/**
 * Turn the findings from Validate Resume, plus anything typed by hand, into the
 * instructions the AI actually receives.
 */
function composeInstructions(brief: ImprovementBrief | null, extra: string): string {
  const lines: string[] = [];
  if (briefCount(brief) > 0) {
    lines.push(
      "These are the findings from my latest resume validation. Fix every one of them, and in the WHAT I CHANGED section state how you addressed each:"
    );
    brief!.weakAreas.forEach((w) =>
      lines.push(`- Weak area — ${w.name} scored ${w.score}/100: ${w.feedback}`)
    );
    brief!.points.forEach((p) => lines.push(`- ${p}`));
    if (brief!.keywords.length)
      lines.push(
        `- Work these missing keywords in naturally, only where they are genuinely true of my experience: ${brief!.keywords.join(
          ", "
        )}. Do not keyword-stuff and do not claim anything I have not done.`
      );
  }
  const typed = extra.trim();
  if (typed) lines.push(lines.length ? `Also: ${typed}` : typed);
  return lines.join("\n");
}

export default function ResumePage() {
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [text, setText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [brief, setBrief] = useState<ImprovementBrief | null>(null);
  const [aiOutput, setAiOutput] = useState("");
  const [busy, setBusy] = useState<"" | "upload" | "improve" | "pdf">("");
  const [error, setError] = useState("");
  const [tpl, setTpl] = useState<"classic" | "modern">("classic");
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const r = store.getResume();
    setResume(r);
    if (r) setText(r.text);
    setBrief(store.getBrief());
    const saved = window.localStorage.getItem("cp_pdf_template");
    if (saved === "classic" || saved === "modern") setTpl(saved);
  }, []);

  /** Keep the on-screen brief and the stored one in step. */
  function updateBrief(next: ImprovementBrief | null) {
    setBrief(next);
    if (next) store.setBrief(next);
    else store.clearBrief();
  }

  function dropPoint(p: string) {
    if (!brief) return;
    updateBrief({ ...brief, points: brief.points.filter((x) => x !== p) });
  }
  function dropKeyword(k: string) {
    if (!brief) return;
    updateBrief({ ...brief, keywords: brief.keywords.filter((x) => x !== k) });
  }
  function dropWeakArea(name: string) {
    if (!brief) return;
    updateBrief({ ...brief, weakAreas: brief.weakAreas.filter((x) => x.name !== name) });
  }

  async function downloadPdf() {
    if (!text.trim()) return setError("Nothing to download — add your resume first.");
    setError("");
    setBusy("pdf");
    try {
      const { buildResumePdf, downloadBlob } = await import("@/lib/pdf/resumeDoc");
      const name = store.getProfile().name || "Resume";
      const blob = await buildResumePdf(text, name, tpl);
      downloadBlob(blob, `${name.replace(/\s+/g, "_")}_Resume.pdf`);
    } catch (err: any) {
      setError(`PDF failed: ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  function pickTemplate(t: "classic" | "modern") {
    setTpl(t);
    window.localStorage.setItem("cp_pdf_template", t);
  }

  function save(newText: string, label: string, fileName?: string) {
    const prev = store.getResume();
    const data: ResumeData = {
      text: newText,
      fileName: fileName ?? prev?.fileName,
      updatedAt: Date.now(),
      versions: [
        ...(prev?.versions || []),
        ...(prev?.text && prev.text !== newText
          ? [{ text: prev.text, label: `Before: ${label}`, at: prev.updatedAt }]
          : []),
      ].slice(-15),
    };
    store.setResume(data);
    setResume(data);
    setText(newText);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-resume", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      save(data.text, "upload", data.fileName);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function improve() {
    if (!text.trim()) return setError("Add your resume text first.");
    setError("");
    setBusy("improve");
    setAiOutput("");
    abortRef.current = new AbortController();
    try {
      await streamTask(
        "improve_resume",
        {
          resume: text,
          profile: store.getProfile(),
          instructions: composeInstructions(brief, instructions),
        },
        (full) => setAiOutput(full),
        abortRef.current.signal
      );
      store.bumpStat("improvements");
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function acceptImproved() {
    const improved = aiOutput.split("=== WHAT I CHANGED ===")[0].trim();
    if (!improved) return;
    save(improved, "AI improvement");
    setAiOutput("");
    // The findings have been applied — a stale brief would just re-apply them.
    updateBrief(null);
  }

  const fixes = briefCount(brief);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">My Resume</h1>
        <p className="muted mt-1">
          Upload once, then improve it with AI as many times as you like. Everything is
          editable.
        </p>
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Editor */}
        <div className="card-pad space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="h2">Resume text</h2>
            <div className="flex items-center gap-2">
              {resume?.fileName && (
                <span className="badge-blue">{resume.fileName}</span>
              )}
              <button
                className="btn-secondary text-xs"
                onClick={() => fileRef.current?.click()}
                disabled={busy === "upload"}
              >
                {busy === "upload" ? "Parsing…" : "Upload PDF / DOCX / TXT"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                onChange={onUpload}
              />
            </div>
          </div>
          <textarea
            className="input font-mono text-[13px] leading-relaxed min-h-[420px] resize-y"
            placeholder={"Paste your resume text here, or upload a file above…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="btn-primary"
              onClick={() => save(text, "manual edit")}
              disabled={!text.trim()}
            >
              Save resume
            </button>
            <select
              className="input w-auto py-2 text-xs"
              value={tpl}
              onChange={(e) => pickTemplate(e.target.value as "classic" | "modern")}
              title="PDF design"
            >
              <option value="classic">Classic (traditional)</option>
              <option value="modern">Modern (tech)</option>
            </select>
            <button
              className="btn-secondary"
              onClick={downloadPdf}
              disabled={!text.trim() || busy === "pdf"}
            >
              {busy === "pdf" ? "Generating…" : "⬇ Download PDF"}
            </button>
            {resume && (
              <span className="text-xs text-ink-400">
                Last saved {new Date(resume.updatedAt).toLocaleString()}
              </span>
            )}
          </div>

          {(resume?.versions?.length || 0) > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-300 hover:text-ink-100">
                Version history ({resume!.versions.length})
              </summary>
              <div className="mt-2 space-y-1.5 max-h-40 overflow-auto">
                {[...resume!.versions].reverse().map((v, i) => (
                  <button
                    key={i}
                    className="w-full text-left rounded-lg px-3 py-2 bg-ink-850 hover:bg-ink-800 text-xs text-ink-300"
                    onClick={() => setText(v.text)}
                    title="Load into editor (click Save to keep)"
                  >
                    {v.label} — {new Date(v.at).toLocaleString()}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* AI improve */}
        <div className="card-pad space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="h2">Improve with AI</h2>
            {fixes > 0 && (
              <span className="badge-blue">
                {fixes} fix{fixes === 1 ? "" : "es"} from validation
              </span>
            )}
          </div>

          {fixes > 0 ? (
            <div className="rounded-xl border border-neon-500/25 bg-neon-500/5 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-ink-200">
                  From your validation on {new Date(brief!.at).toLocaleDateString()} — the
                  AI will fix each of these. Remove anything you disagree with.
                </p>
                <button
                  className="text-[11px] text-ink-400 hover:text-coral-400 underline shrink-0"
                  onClick={() => updateBrief(null)}
                >
                  Clear all
                </button>
              </div>

              <ul className="space-y-1.5 max-h-52 overflow-auto pr-1">
                {brief!.weakAreas.map((w) => (
                  <BriefRow
                    key={`w-${w.name}`}
                    tone="amber"
                    label={`${w.name} (${w.score}/100) — ${w.feedback}`}
                    onRemove={() => dropWeakArea(w.name)}
                  />
                ))}
                {brief!.points.map((p) => (
                  <BriefRow
                    key={`p-${p}`}
                    tone="neon"
                    label={p}
                    onRemove={() => dropPoint(p)}
                  />
                ))}
              </ul>

              {brief!.keywords.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">
                    Keywords to work in
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {brief!.keywords.map((k) => (
                      <button
                        key={k}
                        onClick={() => dropKeyword(k)}
                        title="Remove"
                        className="text-[11px] rounded-full px-2.5 py-1 bg-ink-850 hover:bg-coral-500/15 text-ink-300 hover:text-coral-400"
                      >
                        {k} <span className="opacity-60">×</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <details className="text-[11px] text-ink-400">
                <summary className="cursor-pointer hover:text-ink-200">
                  See exactly what the AI is told
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-ink-300 bg-ink-900 rounded-lg p-2 max-h-40 overflow-auto">
                  {composeInstructions(brief, instructions)}
                </pre>
              </details>
            </div>
          ) : (
            <p className="text-xs text-ink-400">
              Tip:{" "}
              <Link href="/validate" className="text-neon-400 underline">
                validate your resume
              </Link>{" "}
              first and send the findings here — the AI then fixes exactly what scored
              badly instead of guessing.
            </p>
          )}

          <div>
            <label className="label">
              {fixes > 0 ? "Anything else to add" : "Optional instructions"}
            </label>
            <textarea
              className="input min-h-[70px] resize-y text-sm"
              placeholder='e.g. "make it one page", "emphasize React performance work"'
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={improve} disabled={busy === "improve"}>
              {busy === "improve"
                ? "Improving…"
                : fixes > 0
                ? `✦ Fix ${fixes} issue${fixes === 1 ? "" : "s"} & improve`
                : "✦ Improve my resume"}
            </button>
            {busy === "improve" && (
              <button
                className="btn-danger"
                onClick={() => abortRef.current?.abort()}
              >
                Stop
              </button>
            )}
          </div>

          {aiOutput && (
            <>
              <div className="prose-out card p-4 max-h-[420px] overflow-auto">
                {aiOutput}
              </div>
              {busy !== "improve" && (
                <div className="flex gap-2 flex-wrap items-center">
                  <button className="btn-primary" onClick={acceptImproved}>
                    ✓ Accept — replace my resume
                  </button>
                  <button className="btn-secondary" onClick={() => setAiOutput("")}>
                    Discard
                  </button>
                  <Link href="/validate" className="text-xs text-ink-400 underline hover:text-ink-200">
                    Re-validate after accepting →
                  </Link>
                </div>
              )}
            </>
          )}
          {!aiOutput && busy !== "improve" && (
            <p className="text-sm text-ink-400">
              The AI rewrites your resume to industry standard — stronger verbs,
              quantified impact, ATS keywords — and explains every change. You decide
              whether to accept it. Anything it assumed is marked{" "}
              <code className="text-amberx-400">[confirm]</code>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefRow({
  label,
  tone,
  onRemove,
}: {
  label: string;
  tone: "neon" | "amber";
  onRemove: () => void;
}) {
  return (
    <li className="flex gap-2 text-xs text-ink-300 leading-relaxed group">
      <span className={tone === "amber" ? "text-amberx-400" : "text-neon-400"}>●</span>
      <span className="flex-1">{label}</span>
      <button
        onClick={onRemove}
        title="Remove from the brief"
        className="shrink-0 text-ink-600 hover:text-coral-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
      >
        ×
      </button>
    </li>
  );
}
