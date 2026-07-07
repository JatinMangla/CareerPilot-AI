"use client";

import { useEffect, useRef, useState } from "react";
import { store } from "@/lib/store";
import { streamTask } from "@/lib/aiClient";
import type { ResumeData } from "@/lib/types";

export default function ResumePage() {
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [text, setText] = useState("");
  const [instructions, setInstructions] = useState("");
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
    const saved = window.localStorage.getItem("cp_pdf_template");
    if (saved === "classic" || saved === "modern") setTpl(saved);
  }, []);

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
        { resume: text, profile: store.getProfile(), instructions },
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
  }

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
          <h2 className="h2">Improve with AI</h2>
          <div>
            <label className="label">Optional instructions</label>
            <input
              className="input"
              placeholder='e.g. "make it one page", "emphasize React performance work"'
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={improve} disabled={busy === "improve"}>
              {busy === "improve" ? "Improving…" : "✦ Improve my resume"}
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
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={acceptImproved}>
                    ✓ Accept — replace my resume
                  </button>
                  <button className="btn-secondary" onClick={() => setAiOutput("")}>
                    Discard
                  </button>
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
