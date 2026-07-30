"use client";

import type {
  ResumeData,
  Profile,
  ValidationResult,
  Job,
  PreparedApplication,
  QueuedApplication,
  Strategy,
  UsageStats,
} from "./types";

const KEYS = {
  resume: "cp_resume",
  profile: "cp_profile",
  validation: "cp_validation",
  jobs: "cp_jobs",
  apps: "cp_apps",
  queue: "cp_queue",
  strategy: "cp_strategy",
  stats: "cp_stats",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export const defaultProfile: Profile = {
  name: "Jatin Mangla",
  email: "jatinmangla123@gmail.com",
  role: "Frontend Web Developer",
  skills: [
    "JavaScript",
    "TypeScript",
    "HTML",
    "CSS",
    "React",
    "Tailwind CSS",
    "Redux",
    "Git",
    "Node.js (basics)",
  ],
  locations: "India (Remote / Hybrid)",
  desiredRoles: "Frontend Developer, React Developer, UI Engineer",
  portals: ["LinkedIn", "Naukri", "Indeed", "Wellfound"],
  phone: "",
  linkedin: "",
  github: "",
  portfolio: "",
  noticePeriod: "",
  expectedCtc: "",
};

export const defaultStrategy: Strategy = {
  version: 1,
  systemAddendum: "",
  notes: ["Baseline strategy — run Evolve to optimize."],
  updatedAt: Date.now(),
};

export const defaultStats: UsageStats = {
  improvements: 0,
  validations: 0,
  tailors: 0,
  jobsAnalyzed: 0,
  applicationsPrepared: 0,
  interviews: 0,
  practiceSolved: 0,
};

export const store = {
  getResume: () => read<ResumeData | null>(KEYS.resume, null),
  setResume: (r: ResumeData) => write(KEYS.resume, r),

  getProfile: () => read<Profile>(KEYS.profile, defaultProfile),
  setProfile: (p: Profile) => write(KEYS.profile, p),

  getValidation: () => read<ValidationResult | null>(KEYS.validation, null),
  setValidation: (v: ValidationResult) => write(KEYS.validation, v),

  getJobs: () => read<Job[]>(KEYS.jobs, []),
  setJobs: (j: Job[]) => write(KEYS.jobs, j),

  getApps: () => read<PreparedApplication[]>(KEYS.apps, []),
  setApps: (a: PreparedApplication[]) => write(KEYS.apps, a),

  getQueue: () => read<QueuedApplication[]>(KEYS.queue, []),
  setQueue: (q: QueuedApplication[]) => write(KEYS.queue, q),

  getStrategy: () => read<Strategy>(KEYS.strategy, defaultStrategy),
  setStrategy: (s: Strategy) => write(KEYS.strategy, s),

  getStats: () => read<UsageStats>(KEYS.stats, defaultStats),
  bumpStat: (k: keyof UsageStats, by = 1) => {
    const s = read<UsageStats>(KEYS.stats, defaultStats);
    s[k] = (s[k] || 0) + by;
    write(KEYS.stats, s);
    return s;
  },
};
