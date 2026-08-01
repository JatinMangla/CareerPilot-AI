import type { Profile, Strategy, UsageStats, ValidationResult } from "./types";

/**
 * Builds a self-contained prompt to paste into a Claude Pro chat.
 * Pure string assembly — costs no API quota.
 */
export function buildClaudeStrategyPrompt(opts: {
  profile: Profile;
  strategy: Strategy;
  stats: UsageStats;
  resume?: string;
  validation?: ValidationResult | null;
  feedback?: string;
}): string {
  const { profile, strategy, stats, resume, validation, feedback } = opts;

  const resumeBlock = resume
    ? `<my_resume>\n${resume.slice(0, 6000)}\n</my_resume>`
    : "(resume not provided)";

  const validationBlock = validation
    ? `Latest resume audit: overall ${validation.overallScore}/100, ATS ${validation.atsScore}/100.
Weakest areas: ${validation.categories
        .slice()
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((c) => `${c.name} (${c.score})`)
        .join(", ")}.
Missing keywords it flagged: ${validation.missingKeywords.slice(0, 12).join(", ") || "none"}.`
    : "No resume audit has been run yet.";

  return `You are advising on the operating strategy for an AI job-search assistant. I'll paste your answer back into the app, where it becomes standing instructions injected into every future AI task (resume rewriting, job matching, tailoring, cover letters, interview coaching, recruiter email).

## Who this is for
- Name: ${profile.name}
- Current role: ${profile.role}
- Target roles: ${profile.desiredRoles}
- Location / preference: ${profile.locations}
- Skills: ${profile.skills.join(", ")}
- Notice period: ${profile.noticePeriod || "not set"} | Expected CTC: ${profile.expectedCtc || "not set"}

${resumeBlock}

## How the app has been used so far
- Resume improvements: ${stats.improvements}
- Validations: ${stats.validations}
- Tailored versions: ${stats.tailors}
- Jobs analyzed: ${stats.jobsAnalyzed}
- Applications prepared: ${stats.applicationsPrepared}
- Mock interviews: ${stats.interviews}
- Practice questions solved: ${stats.practiceSolved}

${validationBlock}

## Current strategy (version ${strategy.version}) — the instructions to improve on
<current_strategy>
${strategy.systemAddendum || "(empty — this is the baseline, nothing has been set yet)"}
</current_strategy>

${feedback ? `## What I want fixed\n${feedback}\n` : ""}
## What I need from you
Write a sharper replacement for the strategy above. It becomes system-prompt text, so it must be **pure directives** — no preamble, no "here's my answer", no explanation of your reasoning inside it.

Cover, concretely and specifically for this candidate:
1. Resume rules that beat current ATS parsing and recruiter skim behaviour.
2. What actually gets a frontend/React developer shortlisted in the Indian market right now (and for remote roles hiring from India) — including realistic salary framing.
3. How to position the gap between this candidate's real experience and the roles they're targeting, honestly.
4. Cover-letter and recruiter-email angles that get replies rather than silence.
5. Interview answer frameworks tuned to frontend interviews.

Constraints: maximum 280 words. Be specific and opinionated — "quantify impact" is useless, "lead each bullet with a metric or user-facing outcome, e.g. 'cut initial bundle 40% (2.1MB→1.3MB)'" is useful. Do not repeat generic advice already in the current strategy; replace it with something better.

Return exactly this format:

===STRATEGY===
(the directives, max 280 words)

===NOTES===
- (3-5 bullets on what you changed versus the current strategy, and why)`;
}
