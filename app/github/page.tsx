"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";

interface Review {
  verdict: string;
  score: number;
  quickWins: string[];
  repoAdvice: { repo: string; issue: string; fix: string }[];
  profileReadme: string;
  projectIdeas: { title: string; why: string; effort: string }[];
}

export default function GithubPage() {
  const [username, setUsername] = useState("");
  const [data, setData] = useState<any>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const p = store.getProfile();
    if (p.github) setUsername(p.github);
    const saved = window.localStorage.getItem("cp_github_review");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setReview(parsed.review);
        setData(parsed.data);
      } catch {
        /* ignore */
      }
    }
  }, []);

  async function run() {
    const resume = store.getResume();
    if (!resume?.text) return setError("Add your resume first — the audit compares against it.");
    setError("");
    setBusy("fetch");
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const gh = await res.json();
      if (!res.ok) {
        setError(gh.error || "Could not read that profile.");
        return;
      }
      setData(gh);

      setBusy("review");
      const out = await jsonTask<Review>("github_review", {
        profileData: gh.profile,
        repos: gh.repos,
        resume: resume.text,
        profile: store.getProfile(),
      });
      setReview(out);
      window.localStorage.setItem(
        "cp_github_review",
        JSON.stringify({ review: out, data: gh })
      );

      // Remember the username so applications can autofill it.
      const p = store.getProfile();
      if (gh.profile?.url && p.github !== gh.profile.url) {
        store.setProfile({ ...p, github: gh.profile.url });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const scoreTone =
    !review ? "" : review.score >= 70 ? "text-neon-400" : review.score >= 45 ? "text-amberx-400" : "text-coral-400";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">GitHub Review</h1>
        <p className="muted mt-1">
          Recruiters open your GitHub <b className="text-ink-100">before</b> your resume, and
          an optimised profile is worth roughly a 40% lift in callbacks. This audits it the
          way they read it — in under a minute.
        </p>
      </div>

      <div className="card-pad flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="label">GitHub username or profile URL</label>
          <input
            className="input"
            placeholder="JatinMangla"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </div>
        <button className="btn-primary" onClick={run} disabled={!!busy || !username.trim()}>
          {busy === "fetch" ? "Reading GitHub…" : busy === "review" ? "Auditing…" : "◎ Review my profile"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      {busy === "review" && (
        <div className="card-pad text-sm text-ink-300 animate-pulse">
          Reading {data?.repos?.length ?? 0} repositories the way a hiring manager would…
        </div>
      )}

      {data && !busy && (
        <div className="card-pad grid sm:grid-cols-4 gap-4 text-center">
          <Metric label="Public repos" value={data.profile.publicRepos} />
          <Metric label="Own (non-fork)" value={data.repos.length} />
          <Metric
            label="With description"
            value={data.repos.filter((r: any) => r.hasDescription).length}
          />
          <Metric
            label="With live demo"
            value={data.repos.filter((r: any) => r.hasHomepage).length}
            warn={data.repos.filter((r: any) => r.hasHomepage).length === 0}
          />
        </div>
      )}

      {review && !busy && (
        <>
          <div className="card-pad flex items-center gap-5 flex-wrap">
            <div className={`font-display text-5xl font-bold ${scoreTone}`}>{review.score}</div>
            <p className="text-sm text-ink-200 flex-1 min-w-[240px] leading-relaxed">
              {review.verdict}
            </p>
          </div>

          <div className="card-pad">
            <h2 className="h2 mb-3">Do these today</h2>
            <ul className="space-y-2">
              {review.quickWins.map((w, i) => (
                <li key={i} className="text-sm text-ink-200 flex gap-2.5 leading-relaxed">
                  <span className="text-neon-400 shrink-0">{i + 1}.</span> {w}
                </li>
              ))}
            </ul>
          </div>

          {review.repoAdvice.length > 0 && (
            <div className="card-pad">
              <h2 className="h2 mb-3">Repository fixes</h2>
              <div className="space-y-3">
                {review.repoAdvice.map((r, i) => (
                  <div key={i} className="bg-ink-850 rounded-xl p-3">
                    <code className="text-xs text-sky2-400">{r.repo}</code>
                    <p className="text-xs text-coral-400 mt-1.5">{r.issue}</p>
                    <p className="text-xs text-neon-400 mt-1">→ {r.fix}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card-pad">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="h2">Profile README</h2>
              <button
                className="btn-secondary text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(review.profileReadme);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied ✓" : "Copy markdown"}
              </button>
            </div>
            <p className="text-xs text-ink-400 mb-2">
              Create a repo named exactly <code className="text-neon-400">{data?.profile?.login}</code>{" "}
              and paste this into its README.md — GitHub shows it at the top of your profile.
            </p>
            <pre className="prose-out card p-3 max-h-72 overflow-auto text-[11px]">
              {review.profileReadme}
            </pre>
          </div>

          <div className="card-pad">
            <h2 className="h2 mb-3">Projects worth building</h2>
            <div className="space-y-3">
              {review.projectIdeas.map((p, i) => (
                <div key={i} className="bg-ink-850 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-ink-100">{p.title}</span>
                    <span className="badge-blue">{p.effort}</span>
                  </div>
                  <p className="text-xs text-ink-300 mt-1.5 leading-relaxed">{p.why}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!review && !busy && !error && (
        <div className="card-pad space-y-3">
          <h2 className="h2">What this checks</h2>
          <ul className="text-sm text-ink-300 space-y-1.5 leading-relaxed">
            <li>• Whether a recruiter can tell what you build in under a minute</li>
            <li>• Repos missing descriptions, topics, READMEs or live demo links</li>
            <li>• Clutter (practice/test repos) burying your real work</li>
            <li>• A ready-to-paste profile README, and projects worth building next</li>
          </ul>
          <p className="text-xs text-ink-400 leading-relaxed">
            Enter your username above and hit Review — nothing else to set up. Your profile
            URL is saved automatically afterwards and reused to autofill job applications.
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <div className={`font-display text-2xl font-bold ${warn ? "text-coral-400" : "text-ink-100"}`}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">{label}</div>
    </div>
  );
}
