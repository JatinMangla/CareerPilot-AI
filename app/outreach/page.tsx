"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { SentEmail } from "@/lib/types";

type Mode = "new" | "reply";

export default function OutreachPage() {
  const [mode, setMode] = useState<Mode>("new");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [role, setRole] = useState("React Developer");
  const [company, setCompany] = useState("");
  const [context, setContext] = useState("");
  const [tone, setTone] = useState("professional and direct");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [attachResume, setAttachResume] = useState(true);
  const [busy, setBusy] = useState<"" | "compose" | "send">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sent, setSent] = useState<SentEmail[]>([]);
  const [hasResume, setHasResume] = useState(true);

  useEffect(() => {
    setSent(store.getEmails());
    setHasResume(!!store.getResume()?.text);
  }, []);

  async function compose() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — the email quotes it.");
    setError("");
    setSuccess("");
    setBusy("compose");
    try {
      const out = await jsonTask<{ subject: string; body: string; note: string }>(
        "compose_email",
        {
          mode,
          role: role || "React Developer",
          company,
          toEmail: to,
          context,
          tone,
          resume: resume.text,
          profile: store.getProfile(),
        }
      );
      setSubject(out.subject);
      setBody(out.body);
      setNote(out.note);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function send() {
    if (!to.trim()) return setError("Who should this go to? Add the HR email.");
    if (!subject.trim() || !body.trim()) return setError("Generate or write the email first.");
    setError("");
    setSuccess("");
    setBusy("send");
    try {
      const profile = store.getProfile();
      let attachment: { base64: string; filename: string } | undefined;

      if (attachResume) {
        const resume = store.getResume();
        if (resume?.text) {
          const { buildResumePdf } = await import("@/lib/pdf/resumeDoc");
          const tplRaw = window.localStorage.getItem("cp_pdf_template");
          const blob = await buildResumePdf(
            resume.text,
            profile.name,
            tplRaw === "modern" ? "modern" : "classic"
          );
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          attachment = {
            base64: btoa(binary),
            filename: `${profile.name.replace(/\s+/g, "_")}_Resume.pdf`,
          };
        }
      }

      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          cc: cc.trim() || undefined,
          subject: subject.trim(),
          text: body.trim(),
          fromName: profile.name,
          attachment,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Send failed (${res.status})`);
        return;
      }

      const record: SentEmail = {
        id: `${Date.now()}`,
        to: to.trim(),
        cc: cc.trim() || undefined,
        subject: subject.trim(),
        body: body.trim(),
        role,
        company: company || undefined,
        hadAttachment: !!attachment,
        at: Date.now(),
        followUpDue: Date.now() + 5 * 24 * 60 * 60 * 1000,
      };
      const next = [...store.getEmails(), record];
      store.setEmails(next);
      setSent(next);
      setSuccess(`✅ Sent to ${record.to} from your Gmail — a copy is in your Sent folder.`);
      setSubject("");
      setBody("");
      setNote("");
      setTo("");
      setContext("");
      setCompany("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const dueFollowUps = sent.filter(
    (e) => e.followUpDue && Date.now() > e.followUpDue
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">HR Outreach</h1>
        <p className="muted mt-1">
          Write to a hiring contact — or reply to one — and send it{" "}
          <b className="text-ink-100">from your own Gmail</b>, resume attached. Replies
          come straight back to your inbox.
        </p>
      </div>

      {!hasResume && (
        <div className="card-pad text-sm text-ink-300">
          <Link href="/resume" className="text-neon-400 underline">
            Add your resume
          </Link>{" "}
          first — the email is written from it and attached to it.
        </div>
      )}

      {dueFollowUps.length > 0 && (
        <div className="text-xs text-amberx-400 bg-amberx-500/10 border border-amberx-500/25 rounded-xl px-4 py-3">
          ⏰ {dueFollowUps.length} email{dueFollowUps.length > 1 ? "s" : ""} sent 5+ days
          ago with no follow-up — scroll down to nudge them.
        </div>
      )}

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3 whitespace-pre-wrap">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-neon-400 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3">
          {success}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Inputs */}
        <div className="card-pad space-y-4">
          <div className="flex gap-2">
            {(["new", "reply"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold border transition ${
                  mode === m
                    ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                    : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
                }`}
              >
                {m === "new" ? "✉ New application email" : "↩ Reply to HR"}
              </button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label">HR / hiring manager email *</label>
              <input
                className="input"
                type="email"
                placeholder="hr@company.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Role (post)</label>
              <input
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="React Developer"
              />
            </div>
            <div>
              <label className="label">Company (optional)</label>
              <input
                className="input"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">CC (optional)</label>
              <input
                className="input"
                type="email"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">
              {mode === "reply"
                ? "Paste HR's message (so the AI answers everything they asked)"
                : "Job description or any context (optional)"}
            </label>
            <textarea
              className="input min-h-[150px] resize-y"
              placeholder={
                mode === "reply"
                  ? "Paste the email you received…"
                  : "Paste the JD, or leave empty for a strong general application."
              }
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Tone</label>
            <select className="input" value={tone} onChange={(e) => setTone(e.target.value)}>
              <option>professional and direct</option>
              <option>warm and personable</option>
              <option>confident and senior</option>
              <option>brief — under 100 words</option>
            </select>
          </div>

          <button
            className="btn-primary w-full"
            onClick={compose}
            disabled={busy === "compose" || !hasResume}
          >
            {busy === "compose" ? "Writing…" : "✦ Write my email"}
          </button>
        </div>

        {/* Draft + send */}
        <div className="card-pad space-y-4">
          <h2 className="h2">Draft</h2>
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Generated subject appears here — editable"
            />
          </div>
          <div>
            <label className="label">Body — edit anything before sending</label>
            <textarea
              className="input min-h-[300px] resize-y text-[13px] leading-relaxed"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Your email will appear here, ready to edit and send."
            />
          </div>

          {note && (
            <p className="text-xs text-ink-400 bg-ink-850 rounded-xl px-3 py-2 leading-relaxed">
              💡 {note}
            </p>
          )}

          <label className="flex items-center gap-2.5 text-sm text-ink-200 cursor-pointer">
            <input
              type="checkbox"
              className="accent-[#17c996] w-4 h-4"
              checked={attachResume}
              onChange={(e) => setAttachResume(e.target.checked)}
            />
            Attach my resume as PDF
          </label>

          <div className="flex gap-2 flex-wrap">
            <button
              className="btn-primary"
              onClick={send}
              disabled={busy === "send" || !subject.trim() || !body.trim()}
            >
              {busy === "send" ? "Sending…" : "➤ Send from my Gmail"}
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigator.clipboard.writeText(`${subject}\n\n${body}`)}
              disabled={!body.trim()}
            >
              Copy
            </button>
          </div>
          <p className="text-[11px] text-ink-400 leading-relaxed">
            Sends via Gmail SMTP as{" "}
            <b className="text-ink-200">{store.getProfile().email}</b> — HR sees your real
            address, replies reach your inbox, and Gmail keeps a copy in Sent.
          </p>
        </div>
      </div>

      {/* History */}
      {sent.length > 0 && (
        <div className="card-pad">
          <h2 className="h2 mb-4">Sent ({sent.length})</h2>
          <div className="space-y-3">
            {sent
              .slice()
              .reverse()
              .map((e) => {
                const overdue = e.followUpDue && Date.now() > e.followUpDue;
                return (
                  <div key={e.id} className="bg-ink-850 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm text-ink-100 font-semibold truncate">
                          {e.subject}
                        </p>
                        <p className="text-xs text-ink-400">
                          to {e.to} · {e.role}
                          {e.company ? ` @ ${e.company}` : ""} ·{" "}
                          {new Date(e.at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {e.hadAttachment && <span className="badge-blue">📎 resume</span>}
                        {overdue ? (
                          <button
                            className="badge-amber hover:opacity-80"
                            onClick={() => {
                              setMode("reply");
                              setTo(e.to);
                              setRole(e.role);
                              setCompany(e.company || "");
                              setContext(
                                `I sent this on ${new Date(e.at).toLocaleDateString()} and haven't heard back. Write a short, polite follow-up that adds one new reason I'm a fit — do not repeat the original email.\n\nOriginal:\n${e.body}`
                              );
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            ⏰ follow up
                          </button>
                        ) : (
                          <span className="badge-green">sent</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
