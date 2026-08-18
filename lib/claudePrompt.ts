import type { Profile, Strategy, UsageStats, ValidationResult } from "./types";

export interface ClaudePromptInput {
  profile: Profile;
  strategy: Strategy;
  stats: UsageStats;
  resume?: string;
  validation?: ValidationResult | null;
  feedback?: string;
  /** Real outcomes, so Claude critiques results rather than intentions. */
  funnel?: Record<string, number> | null;
  /** Last GitHub audit, if one has been run. */
  github?: Record<string, unknown> | null;
}

/**
 * Builds a self-contained prompt to paste into a Claude Pro chat.
 *
 * Pure string assembly — costs no API quota. The point is to get a second,
 * stronger opinion than the free model can give, then merge the two.
 */
export function buildClaudeStrategyPrompt(opts: ClaudePromptInput): string {
  const { profile, strategy, stats, resume, validation, feedback, funnel, github } = opts;

  const resumeBlock = resume
    ? `<my_resume>\n${resume.slice(0, 6000)}\n</my_resume>`
    : "(resume not provided)";

  const validationBlock = validation
    ? `Resume audit: overall ${validation.overallScore}/100, ATS ${validation.atsScore}/100. Weakest: ${validation.categories
        .slice()
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((c) => `${c.name} (${c.score})`)
        .join(", ")}. Missing keywords it flagged: ${
        validation.missingKeywords.slice(0, 12).join(", ") || "none"
      }.`
    : "No resume audit has been run yet.";

  const funnelBlock =
    funnel && (funnel.applied ?? 0) > 0
      ? `Actual results so far: ${funnel.applied} applications sent, ${funnel.replied} replies, ${funnel.interviews} interviews, ${funnel.offers} offers. Referral asks sent: ${funnel.referralAsksSent ?? 0}; referrals secured: ${funnel.referralsSecured ?? 0}.`
      : "No outcomes recorded yet — nothing has been applied to and tracked through to a result.";

  const githubBlock = github
    ? `GitHub audit: score ${github.score}/100. ${github.publicRepos} public repos, ${github.reposWithDescription} with a description, ${github.reposWithLiveDemo} with a live demo. Verdict: ${github.verdict}`
    : "GitHub has not been audited yet.";

  return `You are stress-testing the operating strategy of an AI job-search assistant I built and use. I will paste your answer back into the app, where it becomes standing instructions injected into every future task it runs: resume rewriting, job matching, per-job tailoring, cover letters, recruiter and referral outreach, inbox triage, and interview coaching.

So write instructions for a model to follow — not advice for a person to read.

## The candidate
- Name: ${profile.name}
- Current role: ${profile.role}
- Target roles: ${profile.desiredRoles}
- Location / preference: ${profile.locations}
- Skills: ${profile.skills.join(", ")}
- Notice period: ${profile.noticePeriod || "not set"} | Expected CTC: ${profile.expectedCtc || "not set"}

${resumeBlock}

## Evidence the current strategy is built on
- Cold portal applications convert at 0.1-2%. Employee referrals convert at ~30% and carry 4-10x the interview rate. Referrals are ~7% of applicants but 30-50% of hires.
- ~75% of resumes are filtered before a human reads them.
- For frontend roles, recruiters open GitHub before the resume; a tidy profile is worth roughly +40% callbacks.
- Frontend interview loops are dominated by a practical 45-60 minute component-building round, not algorithm puzzles.
- Market: India, React roles, ~18% YoY demand growth.

## What is actually happening
${funnelBlock}
${githubBlock}
${validationBlock}

Feature usage: resume improvements ${stats.improvements}, validations ${stats.validations}, tailored versions ${stats.tailors}, jobs analysed ${stats.jobsAnalyzed}, applications prepared ${stats.applicationsPrepared}, mock interviews ${stats.interviews}, practice solved ${stats.practiceSolved}.

## Current strategy (version ${strategy.version}) — improve on this
<current_strategy>
${strategy.systemAddendum || "(empty — nothing set yet)"}
</current_strategy>

${feedback ? `## What I want fixed\n${feedback}\n` : ""}
## What I need from you
Rewrite the strategy so it produces better output than what is there now. Constraints:

1. **Pure directives.** No preamble, no headings addressed to me, no explanation of your reasoning inside the strategy block itself.
2. **Every line must change behaviour.** If a downstream task would do the same thing without the line, cut it. "Quantify impact" is dead weight; "lead each bullet with a metric or a user-facing outcome, e.g. cut initial bundle 40% (2.1MB to 1.3MB)" is not.
3. **Do not regress the channel weighting.** Anything that amounts to "apply to more roles" as the fix for low response contradicts the evidence above.
4. **Be specific to this candidate and this market**, not to job seekers generally. Use the resume and the numbers above.
5. **Improve, do not merely reword.** Where a current directive is already sharp, keep it — I will be checking which parts you preserved.
6. Maximum **320 words**.

Cover, at minimum: what makes this specific resume pass ATS and hold a recruiter's attention; how to position the gap between this candidate's real experience and the roles targeted, honestly; what earns a reply in referral and recruiter outreach; and how to coach the practical frontend interview round.

Return exactly this format:

===STRATEGY===
(the directives, max 320 words)

===NOTES===
- (3-5 bullets: what you changed, what you deliberately kept, and why)`;
}
