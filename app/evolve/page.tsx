"use client";

import { useEffect, useState } from "react";
import { store, defaultStats, defaultStrategy } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import { buildClaudeStrategyPrompt } from "@/lib/claudePrompt";
import type { Strategy, Profile, UsageStats } from "@/lib/types";

export default function EvolvePage() {
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [stats, setStats] = useState<UsageStats>(defaultStats);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justEvolved, setJustEvolved] = useState(false);
  const [claudePrompt, setClaudePrompt] = useState("");
  const [claudeReply, setClaudeReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    setStrategy(store.getStrategy());
    setStats(store.getStats());
    setProfile(store.getProfile());
  }, []);

  async function evolve() {
    setError("");
    setBusy(true);
    setJustEvolved(false);
    try {
      const result = await jsonTask<{ systemAddendum: string; notes: string[] }>(
        "meta_optimize",
        {
          stats,
          strategy,
          userFeedback: feedback,
          // Real results, so the revision is grounded in what's actually
          // happening rather than in generic best practice.
          funnel: buildFunnelSnapshot(),
          github: buildGithubSnapshot(),
        }
      );
      const next: Strategy = {
        version: (strategy?.version ?? 1) + 1,
        systemAddendum: result.systemAddendum,
        notes: result.notes,
        updatedAt: Date.now(),
      };
      store.setStrategy(next);
      setStrategy(next);
      setFeedback("");
      setJustEvolved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function saveProfile() {
    if (profile) store.setProfile(profile);
  }

  /** Applications and what came of them, for grounding strategy revisions. */
  function buildFunnelSnapshot() {
    const apps = store.getApps();
    const tracked = apps.filter((a) => a.outcome);
    const count = (...s: string[]) => tracked.filter((a) => s.includes(a.outcome!)).length;
    const referrals = store.getReferrals();
    return {
      applicationsPrepared: apps.length,
      applied: tracked.length,
      replied: count("replied", "screen", "interview", "offer"),
      interviews: count("interview", "offer"),
      offers: count("offer"),
      rejectedOrGhosted: count("rejected", "ghosted"),
      referralAsksSent: referrals.filter((r) => r.stage !== "planned").length,
      referralsSecured: referrals.filter((r) => r.stage === "referred").length,
    };
  }

  /** Last GitHub audit, if one has been run. */
  function buildGithubSnapshot() {
    try {
      const raw = window.localStorage.getItem("cp_github_review");
      if (!raw) return null;
      const { review, data } = JSON.parse(raw);
      return {
        score: review?.score,
        verdict: review?.verdict,
        publicRepos: data?.profile?.publicRepos,
        reposWithDescription: data?.repos?.filter((r: any) => r.hasDescription).length,
        reposWithLiveDemo: data?.repos?.filter((r: any) => r.hasHomepage).length,
      };
    } catch {
      return null;
    }
  }

  function generateClaudePrompt() {
    if (!profile || !strategy) return;
    setClaudePrompt(
      buildClaudeStrategyPrompt({
        profile,
        strategy,
        stats,
        resume: store.getResume()?.text,
        validation: store.getValidation(),
        feedback,
        funnel: buildFunnelSnapshot(),
        github: buildGithubSnapshot(),
      })
    );
    setCopied(false);
  }

  /**
   * Folds the current evidence-based baseline into whatever strategy the user
   * already has, keeping the sharper directive wherever the two overlap. Their
   * own tuned strategy is worth preserving — this adds what it predates.
   */
  async function applyBaseline() {
    setError("");
    setMerging(true);
    try {
      const result = await jsonTask<{ systemAddendum: string; notes: string[] }>(
        "merge_strategies",
        {
          current: strategy?.systemAddendum || "",
          claudeOutput: defaultStrategy.systemAddendum,
          profile,
          stats,
        }
      );
      const next: Strategy = {
        version: (strategy?.version ?? 1) + 1,
        systemAddendum: result.systemAddendum,
        notes: result.notes,
        updatedAt: Date.now(),
      };
      store.setStrategy(next);
      setStrategy(next);
      setJustEvolved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMerging(false);
    }
  }

  async function mergeBrains() {
    if (!claudeReply.trim()) return setError("Paste Claude's answer first.");
    setError("");
    setMerging(true);
    try {
      const result = await jsonTask<{ systemAddendum: string; notes: string[] }>(
        "merge_strategies",
        {
          current: strategy?.systemAddendum || "",
          claudeOutput: claudeReply,
          profile,
          stats,
        }
      );
      const next: Strategy = {
        version: (strategy?.version ?? 1) + 1,
        systemAddendum: result.systemAddendum,
        notes: result.notes,
        updatedAt: Date.now(),
      };
      store.setStrategy(next);
      setStrategy(next);
      setClaudeReply("");
      setClaudePrompt("");
      setJustEvolved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Evolve AI</h1>
        <p className="muted mt-1">
          One button. The AI reviews how you use it and rewrites its own operating
          strategy — resume style rules, market tactics, interview frameworks — so every
          future output gets sharper. The new strategy is injected into all its prompts.
        </p>
      </div>

      {error && (
        <div className="text-sm text-coral-400 bg-coral-500/10 border border-coral-500/25 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="card-pad space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-display text-3xl font-bold text-neon-400">
              Strategy v{strategy?.version ?? 1}
            </div>
            <div className="text-xs text-ink-400 mt-1">
              Last evolved{" "}
              {strategy ? new Date(strategy.updatedAt).toLocaleString() : "never"}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              className="btn-secondary"
              onClick={applyBaseline}
              disabled={busy || merging}
              title="Fold the latest hiring research into your existing strategy, keeping what you already have"
            >
              {merging ? "Merging…" : "↻ Apply latest research"}
            </button>
            <button className="btn-primary text-base px-6 py-3" onClick={evolve} disabled={busy}>
              {busy ? "Evolving…" : "∞ Evolve now"}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Optional: tell it what to get better at</label>
          <input
            className="input"
            placeholder='e.g. "cover letters feel generic", "focus on remote US jobs"'
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </div>

        {justEvolved && (
          <div className="text-sm text-neon-400 bg-neon-500/10 border border-neon-500/25 rounded-xl px-4 py-3">
            ✓ Evolved to v{strategy?.version}. Every AI feature now runs with the upgraded
            strategy.
          </div>
        )}
      </div>

      {/* Two-brain mode */}
      <div className="card-pad space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="h2">🧠🧠 Two-brain mode</h2>
            <p className="text-sm text-ink-300 mt-1 leading-relaxed max-w-2xl">
              Get a second opinion from your Claude Pro subscription, then merge it with
              this app&apos;s strategy. Claude tends to be stronger at nuanced positioning;
              merging keeps the sharper directive from each.
            </p>
          </div>
          <button className="btn-secondary" onClick={generateClaudePrompt}>
            ① Build prompt for Claude
          </button>
        </div>

        {claudePrompt && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="btn-primary text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(claudePrompt);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "✓ Copied" : "② Copy prompt"}
              </button>
              <a
                href="https://claude.ai/new"
                target="_blank"
                rel="noreferrer"
                className="btn-secondary text-xs"
              >
                ③ Open Claude Pro ↗
              </a>
              <span className="text-xs text-ink-400">
                paste it there, then bring the answer back below
              </span>
            </div>
            <details>
              <summary className="text-xs text-ink-300 cursor-pointer hover:text-ink-100">
                Preview the prompt ({claudePrompt.length.toLocaleString()} characters)
              </summary>
              <pre className="prose-out card p-3 mt-2 max-h-64 overflow-auto text-[11px]">
                {claudePrompt}
              </pre>
            </details>
          </div>
        )}

        <div>
          <label className="label">④ Paste Claude&apos;s answer here</label>
          <textarea
            className="input min-h-[160px] resize-y text-[13px]"
            placeholder="Paste everything Claude replied — the ===STRATEGY=== and ===NOTES=== blocks. Extra commentary is fine, it gets filtered out."
            value={claudeReply}
            onChange={(e) => setClaudeReply(e.target.value)}
          />
        </div>
        <button
          className="btn-primary"
          onClick={mergeBrains}
          disabled={merging || !claudeReply.trim()}
        >
          {merging ? "Merging both brains…" : "⑤ Merge into my strategy"}
        </button>
        <p className="text-[11px] text-ink-400 leading-relaxed">
          Merging bumps your strategy version just like Evolve does — the result is
          injected into every AI task afterwards. Nothing is sent to Anthropic from this
          app; you&apos;re copy-pasting through your own Claude Pro chat.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card-pad">
          <h2 className="h2 mb-3">What changed in this evolution</h2>
          <ul className="space-y-2">
            {(strategy?.notes || []).map((n, i) => (
              <li key={i} className="text-sm text-ink-300 flex gap-2">
                <span className="text-neon-400">▸</span> {n}
              </li>
            ))}
          </ul>
        </div>
        <div className="card-pad">
          <h2 className="h2 mb-3">Active strategy directives</h2>
          <p className="text-xs text-ink-300 leading-relaxed whitespace-pre-wrap max-h-64 overflow-auto">
            {strategy?.systemAddendum || "Baseline — no evolved directives yet. Hit Evolve."}
          </p>
        </div>
      </div>

      {/* Profile settings */}
      {profile && (
        <div className="card-pad space-y-4">
          <h2 className="h2">My profile (used in every AI task)</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Current role</label>
              <input
                className="input"
                value={profile.role}
                onChange={(e) => setProfile({ ...profile, role: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Desired roles</label>
              <input
                className="input"
                value={profile.desiredRoles}
                onChange={(e) => setProfile({ ...profile, desiredRoles: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Locations</label>
              <input
                className="input"
                value={profile.locations}
                onChange={(e) => setProfile({ ...profile, locations: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Skills (comma-separated)</label>
              <input
                className="input"
                value={profile.skills.join(", ")}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
          </div>

          <div className="pt-2 border-t border-ink-800">
            <h3 className="font-display font-bold text-sm text-ink-100 mb-1">
              Application form details
            </h3>
            <p className="text-xs text-ink-400 mb-3">
              Auto-Pilot fills these into company application forms. Blank fields are left
              for you to complete, so filling them here means fewer manual steps.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Phone</label>
                <input
                  className="input"
                  placeholder="+91 98765 43210"
                  value={profile.phone || ""}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="label">LinkedIn URL</label>
                <input
                  className="input"
                  placeholder="https://linkedin.com/in/…"
                  value={profile.linkedin || ""}
                  onChange={(e) => setProfile({ ...profile, linkedin: e.target.value })}
                />
              </div>
              <div>
                <label className="label">GitHub URL</label>
                <input
                  className="input"
                  placeholder="https://github.com/JatinMangla"
                  value={profile.github || ""}
                  onChange={(e) => setProfile({ ...profile, github: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Portfolio / website</label>
                <input
                  className="input"
                  placeholder="https://…"
                  value={profile.portfolio || ""}
                  onChange={(e) => setProfile({ ...profile, portfolio: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Notice period</label>
                <input
                  className="input"
                  placeholder="e.g. 30 days / Immediate"
                  value={profile.noticePeriod || ""}
                  onChange={(e) => setProfile({ ...profile, noticePeriod: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Expected CTC</label>
                <input
                  className="input"
                  placeholder="e.g. ₹12 LPA"
                  value={profile.expectedCtc || ""}
                  onChange={(e) => setProfile({ ...profile, expectedCtc: e.target.value })}
                />
              </div>
            </div>
          </div>

          <button className="btn-primary" onClick={saveProfile}>
            Save profile
          </button>
        </div>
      )}
    </div>
  );
}
