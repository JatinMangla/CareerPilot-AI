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
