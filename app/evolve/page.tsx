"use client";

import { useEffect, useState } from "react";
import { store, defaultStats } from "@/lib/store";
import { jsonTask } from "@/lib/aiClient";
import type { Strategy, Profile, UsageStats } from "@/lib/types";

export default function EvolvePage() {
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [stats, setStats] = useState<UsageStats>(defaultStats);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justEvolved, setJustEvolved] = useState(false);

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
        { stats, strategy, userFeedback: feedback }
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
          <button className="btn-primary text-base px-6 py-3" onClick={evolve} disabled={busy}>
            {busy ? "Evolving…" : "∞ Evolve now"}
          </button>
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
          <button className="btn-primary" onClick={saveProfile}>
            Save profile
          </button>
        </div>
      )}
    </div>
  );
}
