export interface ResumeVersion {
  text: string;
  label: string;
  at: number;
}

export interface ResumeData {
  text: string;
  fileName?: string;
  updatedAt: number;
  versions: ResumeVersion[];
}

export interface Profile {
  name: string;
  email: string;
  role: string;
  skills: string[];
  locations: string;
  desiredRoles: string;
  portals: string[]; // which portals to target in auto-apply
  /* Used by the Auto-Pilot agent to fill application forms */
  phone?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  noticePeriod?: string;
  expectedCtc?: string;
}

export interface ValidationCategory {
  name: string;
  score: number; // 0-100
  feedback: string;
}

export interface ValidationResult {
  overallScore: number;
  atsScore: number;
  categories: ValidationCategory[];
  missingKeywords: string[];
  strengths: string[];
  improvements: string[];
  verdict: string;
  at: number;
}

export interface ProposedChange {
  id: string;
  section: string;
  current: string;
  proposed: string;
  reason: string;
}

export interface TailorPlan {
  summary: string;
  questions: string[];
  changes: ProposedChange[];
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  url: string;
  source: string; // "adzuna" | "ai-researched"
  matchScore: number; // 0-100
  pros: string[];
  cons: string[];
  jobSecurity: string; // e.g. "High — funded, growing team"
  futureOutlook: string; // good for career future or not
  recommendation: string; // apply / skip advice
  description?: string;
}

export interface PreparedApplication {
  jobId: string;
  jobTitle: string;
  company: string;
  portal: string;
  url: string;
  status: "prepared" | "applied";
  coverLetter: string;
  tailoredHighlights: string[];
  screeningAnswers: { question: string; answer: string }[];
  at: number;
}

/* ---------- Auto-Pilot (direct apply on company career sites) ---------- */

export interface TailorChange {
  id: string;
  section: string;
  before: string;
  after: string;
  reason: string;
  /** Only present on newClaims — what the AI needs to confirm with you. */
  question?: string;
}

export interface AutoTailorPlan {
  verdict: "ready" | "needs_approval";
  summary: string;
  /** Reframings of experience already in your resume — applied automatically. */
  safeChanges: TailorChange[];
  /** Would assert something not in your resume — requires your yes/no. */
  newClaims: TailorChange[];
  /** Resume with ONLY the safe changes applied. */
  tailoredResume: string;
  coverLetter: string;
  screeningAnswers: { question: string; answer: string; confidence: string }[];
}

export type QueueStatus =
  | "planning"
  | "needs_approval"
  | "approved"
  | "exported"
  | "submitted"
  | "failed";

export interface QueuedApplication {
  jobId: string;
  title: string;
  company: string;
  url: string;
  atsKind: string;
  atsLabel: string;
  autoSubmit: boolean;
  status: QueueStatus;
  plan: AutoTailorPlan | null;
  approvedClaimIds: string[];
  finalResume: string;
  error?: string;
  at: number;
}

export interface SentEmail {
  id: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  role: string;
  company?: string;
  hadAttachment: boolean;
  at: number;
  followUpDue?: number;
}

export interface Strategy {
  version: number;
  systemAddendum: string;
  notes: string[];
  updatedAt: number;
}

export interface UsageStats {
  improvements: number;
  validations: number;
  tailors: number;
  jobsAnalyzed: number;
  applicationsPrepared: number;
  interviews: number;
  practiceSolved: number;
}

export interface PracticeQuestion {
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topic: string;
  description: string;
  examples: string[];
  hints: string[];
  starterCode: string;
}

export interface SolutionReview {
  verdict: "Accepted" | "Partially Correct" | "Needs Work";
  score: number;
  feedback: string;
  complexity: string;
  optimalSolution: string;
}
