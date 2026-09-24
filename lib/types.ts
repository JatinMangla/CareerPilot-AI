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
  /**
   * Total professional experience. Drives which job levels count as a fit and how
   * the AI judges seniority — the prompts used to assume "1-3 years" for everyone.
   */
  yearsExperience?: number;
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

/**
 * The fixes carried from Validate Resume -> "Improve with AI".
 *
 * Kept structured (not one blob of text) so the resume page can list each
 * point, let you drop the ones you disagree with, and rebuild the prompt.
 */
export interface ImprovementBrief {
  /** Improvement points, verbatim from the validation. */
  points: string[];
  /** Keywords the resume is missing. */
  keywords: string[];
  /** Categories that scored badly — the AI gets the score and the feedback. */
  weakAreas: ValidationCategory[];
  /** When the validation that produced this ran. */
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
  /** When this listing was first added to the local list. */
  foundAt?: number;
  /** Which source filter produced it — "boards" | "yc" | "portals" | "ai". */
  via?: string;
  /** When the employer posted it, where the source says. */
  postedAt?: string;
  /**
   * false = only the quick, no-AI score so far (lib/jobScore.ts); matchScore
   * and pros/cons then come from that. Absent on jobs saved before quick
   * scoring existed, which were all AI-analysed.
   */
  aiScored?: boolean;
}

/**
 * A job the user removed.
 *
 * Stored by fingerprint (company + normalized title), never by id: every search
 * mints new ids, so an id-keyed list stopped matching and the removed job came
 * straight back on the next search.
 */
export interface DismissedJob {
  fp: string;
  title: string;
  company: string;
  at: number;
}

/* ---------- Referrals (the highest-converting channel) ---------- */

export interface ReferralPlan {
  whoToAsk: string[];
  searchQueries: string[];
  connectionNote: string;
  referralMessage: string;
  coldEmail: { subject: string; body: string };
  whyMeBullets: string[];
  risk: string;
}

export type ReferralStage = "planned" | "asked" | "accepted" | "referred" | "declined";

export interface ReferralRecord {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  contact?: string;
  stage: ReferralStage;
  plan: ReferralPlan;
  at: number;
  updatedAt: number;
}

/* ---------- Application outcomes (so there's a learning loop) ---------- */

export type OutcomeStage =
  | "applied"
  | "replied"
  | "screen"
  | "interview"
  | "offer"
  | "rejected"
  | "ghosted";

export const OUTCOME_STAGES: OutcomeStage[] = [
  "applied",
  "replied",
  "screen",
  "interview",
  "offer",
  "rejected",
  "ghosted",
];

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
  /** Where it got to — the basis for the funnel on the dashboard. */
  outcome?: OutcomeStage;
  outcomeAt?: number;
  /** Which channel produced it, so conversion can be compared per source. */
  source?: string;
  /** Last time it was opened in a tab — so "open next" moves on through the list. */
  openedAt?: number;
  /** The job's match score when it was sent, to compare results by fit. */
  matchScore?: number;
  /** updatedAt of the resume that was sent, to compare results by resume version. */
  resumeVersion?: number;
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
  /** Opened in a browser tab for you to submit yourself. */
  | "opened"
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
  /* Outcome tracking, as on PreparedApplication — Auto-Pilot sends count too. */
  outcome?: OutcomeStage;
  outcomeAt?: number;
  source?: string;
  matchScore?: number;
  resumeVersion?: number;
}

/* ---------- Inbox triage ---------- */

export type MailCategory =
  | "applied_reply"
  | "recruiter_outreach"
  | "job_alert"
  | "bulk_requirement"
  | "not_job";

/**
 * Where the last IMAP sync stopped. A UID is only comparable within one
 * mailbox generation, so it travels with the `uidValidity` it was issued under.
 */
export interface InboxCursor {
  uid: number;
  uidValidity: string;
}

export interface InboxMessage {
  uid: string;
  from: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  /* filled in by AI triage */
  category?: MailCategory;
  relevance?: number;
  company?: string;
  role?: string;
  summary?: string;
  actionNeeded?: boolean;
  suggestedAction?: string;
  deadline?: string;
  handled?: boolean;
  /** Set locally when triage ran, so a re-sync doesn't re-pay for classification. */
  classifiedAt?: string;
}

export interface OutreachDraft {
  mode: "new" | "reply";
  to: string;
  role?: string;
  company?: string;
  context?: string;
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
