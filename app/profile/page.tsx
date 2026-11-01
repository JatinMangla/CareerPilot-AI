"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import type { Profile } from "@/lib/types";

type TextKey = "name" | "role" | "desiredRoles" | "locations" | "phone" | "linkedin" | "github" | "portfolio" | "noticePeriod" | "expectedCtc";

const ABOUT: { key: TextKey; label: string; placeholder?: string }[] = [
  { key: "name", label: "Name" },
  { key: "role", label: "Current role" },
  { key: "desiredRoles", label: "Desired roles", placeholder: "Frontend Developer, React Developer" },
  { key: "locations", label: "Locations" },
];

const FORM_DETAILS: { key: TextKey; label: string; placeholder: string }[] = [
  { key: "phone", label: "Phone", placeholder: "+91 98765 43210" },
  { key: "linkedin", label: "LinkedIn URL", placeholder: "https://linkedin.com/in/…" },
  { key: "github", label: "GitHub URL", placeholder: "https://github.com/…" },
  { key: "portfolio", label: "Portfolio / website", placeholder: "https://…" },
  { key: "noticePeriod", label: "Notice period", placeholder: "e.g. 30 days / Immediate" },
  { key: "expectedCtc", label: "Expected CTC", placeholder: "e.g. ₹12 LPA" },
];

/**
 * Who you are, and what the app holds about you.
 *
 * The profile used to sit at the bottom of Evolve AI, where nothing suggested
 * looking for it, even though years of experience decide which jobs count as a fit
 * and every AI task reads it.
 */
export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [skillsText, setSkillsText] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const p = store.getProfile();
    setProfile(p);
    setSkillsText(p.skills.join(", "));
  }, []);

  if (!profile) return null;

  function save() {
    setSaved(store.setProfile(profile!) !== false);
    setTimeout(() => setSaved(false), 2500);
  }

  function field(key: TextKey, label: string, placeholder?: string) {
    return (
      <div key={key}>
        <label className="label" htmlFor={`profile-${key}`}>{label}</label>
        <input
          id={`profile-${key}`}
          className="input"
          placeholder={placeholder}
          value={profile![key] || ""}
          onChange={(e) => setProfile({ ...profile!, [key]: e.target.value })}
        />
      </div>
    );
  }

  async function downloadData() {
    const stamp = new Date().toISOString().slice(0, 10);
    // Imported here: that module is where the whole PDF engine comes in.
    const { downloadBlob } = await import("@/lib/pdf/resumeDoc");
    downloadBlob(
      new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" }),
      `careerpilot-backup-${stamp}.json`
    );
  }

  async function clearDevice() {
    const unsynced = store.unsyncedCount();
    const warning = unsynced
      ? `${unsynced} recent change${unsynced === 1 ? " has" : "s have"} not reached the server yet and will be lost.\n\n`
      : "";
    if (!window.confirm(`${warning}Remove everything this browser holds? Your other devices and your database keep their copy.`)) {
      return;
    }
    // Sign out first, so nothing can sync back in between. Offline, the clear still
    // has to happen: the point is this machine.
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
    store.clearDevice();
    // A full load, which also drops what the app holds in memory.
    window.location.assign("/login");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="h1">Profile &amp; data</h1>
        <p className="muted mt-1">Every AI task reads this, and application forms are filled from it.</p>
      </div>

      <div className="card-pad space-y-4">
        <h2 className="h2">About you</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {ABOUT.map((f) => field(f.key, f.label, f.placeholder))}
          <div>
            <label className="label" htmlFor="profile-years">Years of professional experience</label>
            <input
              id="profile-years"
              className="input"
              type="number"
              min={0}
              max={50}
              step={0.5}
              placeholder="e.g. 4.5"
              value={profile.yearsExperience ?? ""}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  yearsExperience: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
            <p className="text-[11px] text-ink-400 mt-1">
              Decides which levels job search treats as a fit, and how the AI scores seniority.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="profile-skills">Skills (comma-separated)</label>
            {/* Edited as raw text: rebuilding it from the parsed list on every
                keystroke deleted a trailing comma, so no new skill could be typed. */}
            <input
              id="profile-skills"
              className="input"
              value={skillsText}
              onChange={(e) => {
                setSkillsText(e.target.value);
                setProfile({
                  ...profile,
                  skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                });
              }}
            />
          </div>
        </div>
      </div>

      <div className="card-pad space-y-4">
        <div>
          <h2 className="h2">Application form details</h2>
          <p className="text-xs text-ink-400 mt-1">
            The local form-filler enters these into company application forms. Anything blank is
            left for you, so filling them in here means less typing later.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {FORM_DETAILS.map((f) => field(f.key, f.label, f.placeholder))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save}>Save profile</button>
        {saved && (
          <span role="status" className="text-xs text-neon-400">
            ✓ Saved. Every AI task uses it from now on.
          </span>
        )}
      </div>

      <div className="card-pad space-y-4">
        <div>
          <h2 className="h2">Your data</h2>
          <p className="text-xs text-ink-400 mt-1 leading-relaxed">
            Your resume, applications and job mail live in this browser and in your own database,
            and sync between your devices. Signing out leaves this browser&apos;s copy in place, so
            on a computer you share, remove it as well.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={downloadData}>⬇ Download a backup</button>
          <button className="btn-danger" onClick={clearDevice}>Sign out and remove from this browser</button>
        </div>
      </div>
    </div>
  );
}
