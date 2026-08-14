/**
 * Server-side task registry for /api/ai.
 * Each task defines: mode ("stream" = plain text stream, "json" = structured output),
 * a prompt builder, and (for json) an output schema enforced by the API.
 */

type TaskMode = "stream" | "json";

/**
 * Quality tier — selects the model and thinking budget in lib/gemini.ts.
 *
 *   fast     — classification, judging, short interview turns
 *   standard — most work (default)
 *   deep     — the writing that actually goes in front of an employer
 */
export type TaskTier = "fast" | "standard" | "deep";

export interface TaskDef {
  mode: TaskMode;
  maxTokens?: number;
  /** Defaults to "standard" when unset. */
  tier?: TaskTier;
  build: (input: Record<string, any>) => { system: string; user: string };
  schema?: Record<string, any>;
}

export const SYSTEM_BASE = `You are CareerPilot AI — an elite career copilot for Jatin Mangla, a frontend web developer (JavaScript, TypeScript, HTML, CSS, React, Tailwind CSS, Redux, Git, basic Node.js) who worked on the Mera Monitor website.

Your standards:
- Resume advice follows current ATS best practices: strong action verbs, quantified impact, relevant keywords, clean single-column structure, no fluff.
- You are direct and specific. Never generic filler like "team player with good communication skills".
- Everything you produce should be immediately usable — real sentences, real bullet points, real answers.
- When information is missing, make the most reasonable assumption for an Indian frontend developer with ~1-3 years of experience, and clearly mark assumptions with [confirm].
- Never fabricate employers, degrees, or dates that were not provided.`;

const str = { type: "string" } as const;
const strArr = { type: "array", items: { type: "string" } } as const;
const int = { type: "integer" } as const;

function obj(properties: Record<string, any>, required?: string[]) {
  return {
    type: "object",
    properties,
    required: required ?? Object.keys(properties),
    additionalProperties: false,
  };
}

const jobSchema = obj({
  id: str,
  title: str,
  company: str,
  location: str,
  salary: str,
  url: str,
  source: str,
  matchScore: int,
  pros: strArr,
  cons: strArr,
  jobSecurity: str,
  futureOutlook: str,
  recommendation: str,
  description: str,
});

export const tasks: Record<string, TaskDef> = {
  // ---------- Resume improvement (streamed text) ----------
  improve_resume: {
    mode: "stream",
    tier: "deep", // this text goes in front of employers
    maxTokens: 32000,
    build: ({ resume, profile, instructions }) => ({
      system: SYSTEM_BASE,
      user: `Here is my current resume:

<resume>
${resume}
</resume>

My profile: ${JSON.stringify(profile)}

${instructions ? `Specific instructions from me: ${instructions}` : "Rewrite this resume to be the strongest possible version of itself for frontend developer roles."}

Output ONLY the full improved resume in clean plain text (section headers in CAPS, bullet points with "-"). After the resume, add a section "=== WHAT I CHANGED ===" listing the key improvements and why. Mark any assumed detail with [confirm].`,
    }),
  },

  // ---------- Industry-standard validation (JSON) ----------
  validate_resume: {
    mode: "json",
    maxTokens: 8000,
    build: ({ resume }) => ({
      system: SYSTEM_BASE,
      user: `Evaluate this resume against current industry standards for frontend developer roles in India and globally (ATS compatibility, impact quantification, keyword coverage, structure, readability, seniority signaling):

<resume>
${resume}
</resume>

Score strictly — a typical resume should land 55-70, only a genuinely excellent one above 85.`,
    }),
    schema: obj({
      overallScore: int,
      atsScore: int,
      categories: {
        type: "array",
        items: obj({ name: str, score: int, feedback: str }),
      },
      missingKeywords: strArr,
      strengths: strArr,
      improvements: strArr,
      verdict: str,
    }),
  },

  // ---------- Tailor to job description: plan first, ask before applying ----------
  tailor_plan: {
    mode: "json",
    maxTokens: 8000,
    build: ({ resume, jobDescription }) => ({
      system: SYSTEM_BASE,
      user: `I want to tailor my resume for this job. Propose changes but DO NOT rewrite yet — I will approve each change first.

<resume>
${resume}
</resume>

<job_description>
${jobDescription}
</job_description>

Produce:
1. "summary" — 2-3 sentences on how well I fit and the tailoring strategy.
2. "questions" — up to 4 questions for me where my real experience matters (e.g. "Did you work with REST APIs on Mera Monitor?"). Empty array if none needed.
3. "changes" — each proposed change with a short unique id, the section it affects, the current text (or "NEW" if adding), the proposed text, and the reason tied to the job description. Never invent experience I don't have — changes must reframe real experience.`,
    }),
    schema: obj({
      summary: str,
      questions: strArr,
      changes: {
        type: "array",
        items: obj({ id: str, section: str, current: str, proposed: str, reason: str }),
      },
    }),
  },

  apply_tailor: {
    mode: "stream",
    tier: "deep",
    maxTokens: 32000,
    build: ({ resume, jobDescription, acceptedChanges, answers }) => ({
      system: SYSTEM_BASE,
      user: `Apply ONLY the approved changes to my resume for this job.

<resume>
${resume}
</resume>

<job_description>
${jobDescription}
</job_description>

Approved changes:
${JSON.stringify(acceptedChanges, null, 2)}

My answers to your questions:
${answers || "(none)"}

Output ONLY the final tailored resume in clean plain text (section headers in CAPS, bullets with "-"). No commentary.`,
    }),
  },

  // ---------- Job discovery & analysis ----------
  find_jobs: {
    mode: "json",
    maxTokens: 16000,
    build: ({ resume, profile, count, focus }) => ({
      system: SYSTEM_BASE,
      user: `Based on my resume and profile, list ${count || 8} realistic, currently-plausible job openings that fit me.

${
  focus === "yc"
    ? `IMPORTANT — restrict this to Y Combinator-backed startups only. Use real YC companies (any batch) that plausibly hire frontend/React engineers, favouring ones that hire remotely or in India. For "url", give their Work at a Startup listing (https://www.workatastartup.com/companies/<company-slug>) or the company's own careers page — YC startups almost always use Ashby, Greenhouse or Lever. In "pros"/"cons" be honest about startup reality: equity vs cash, scope vs stability, and whether they realistically hire from India.`
    : `Use companies actively hiring frontend/React developers in India or remote — well-known companies and typical current openings.`
}

<resume>
${resume}
</resume>

Profile: ${JSON.stringify(profile)}

For each job: id (slug), title, company, location, salary (realistic INR range e.g. "₹8-14 LPA"), url (the company's careers page or a portal search URL that would surface this role), source (set to "ai-researched"), matchScore (0-100 vs my resume), pros (3-4), cons (2-3, honest), jobSecurity (one line: funding/stability read), futureOutlook (one line: is this good for my career growth or not), recommendation (one line: apply or skip and why), description (2-3 sentence role summary).

Be honest in cons — e.g. "requires 3+ yrs, you may be screened out". These are AI-researched leads to verify, not live scraped listings.`,
    }),
    schema: obj({ jobs: { type: "array", items: jobSchema } }),
  },

  analyze_jobs: {
    mode: "json",
    maxTokens: 16000,
    build: ({ jobs, resume }) => ({
      system: SYSTEM_BASE,
      user: `Here are real job listings fetched from a job API, plus my resume. Analyze each for me.

<listings>
${JSON.stringify(jobs, null, 2)}
</listings>

<resume>
${resume}
</resume>

Return the same jobs enriched: keep id/title/company/location/url/description/source from the listing exactly as given (salary: use listing salary or estimate a realistic range), and add matchScore, pros, cons (honest), jobSecurity, futureOutlook, recommendation.`,
    }),
    schema: obj({ jobs: { type: "array", items: jobSchema } }),
  },

  // ---------- Auto-Pilot: tailor with an approval gate ----------
  auto_tailor: {
    mode: "json",
    tier: "deep", // may be submitted without further review
    maxTokens: 20000,
    build: ({ resume, job, profile }) => ({
      system: `${SYSTEM_BASE}

You are preparing an application that may be SUBMITTED AUTOMATICALLY without further human review. Integrity rules are absolute:
- A "safeChange" only rewords, reorders, or re-emphasizes experience that ALREADY EXISTS in the resume. Changing "Built dashboards" to "Built responsive React dashboards used by 200+ users" is only safe if BOTH the React work and the user count already appear in the resume.
- Anything that would state a skill, tool, metric, responsibility, or timeframe not present in the resume is a "newClaim" — even if it is likely true. Never quietly promote a newClaim to a safeChange.
- If the resume genuinely cannot support a requirement, say so in the summary rather than inventing coverage.`,
      user: `Tailor my resume for this specific job.

<resume>
${resume}
</resume>

<job>
${JSON.stringify(job, null, 2)}
</job>

<profile>
${JSON.stringify(profile)}
</profile>

Produce:
1. "verdict" — "ready" if newClaims is empty, otherwise "needs_approval".
2. "summary" — 2-3 sentences: how well I fit, and what tailoring you did.
3. "safeChanges" — reframings of existing resume content. Each: short unique id, section, before (exact current text), after, reason tied to the job.
4. "newClaims" — changes that would assert something NOT in my resume. Each: id, section, before (or "NEW"), after, reason, and "question" phrased directly to me (e.g. "Have you used TypeScript with Redux Toolkit in production?").
5. "tailoredResume" — my full resume with ONLY the safeChanges applied. Clean plain text, section headers in CAPS, bullets with "-". No placeholders, no [confirm] markers, no commentary — this file may be submitted as-is.
6. "coverLetter" — 150-220 words, specific to this company and role, using only real experience.
7. "screeningAnswers" — 6-8 questions this employer's application form is likely to ask (notice period, expected CTC, current location, willingness to relocate, years with React, work authorization, why this company), each with a ready-to-submit answer and a "confidence" of "high" (safe to auto-submit) or "low" (needs my input). Use my profile for facts; mark anything you had to guess as low confidence.`,
    }),
    schema: obj({
      verdict: str,
      summary: str,
      safeChanges: {
        type: "array",
        items: obj({ id: str, section: str, before: str, after: str, reason: str }),
      },
      newClaims: {
        type: "array",
        items: obj({
          id: str,
          section: str,
          before: str,
          after: str,
          reason: str,
          question: str,
        }),
      },
      tailoredResume: str,
      coverLetter: str,
      screeningAnswers: {
        type: "array",
        items: obj({ question: str, answer: str, confidence: str }),
      },
    }),
  },

  merge_claims: {
    mode: "stream",
    tier: "deep",
    maxTokens: 20000,
    build: ({ resume, approvedClaims, answers }) => ({
      system: SYSTEM_BASE,
      user: `Merge ONLY these approved changes into my resume. Do not add anything else.

<resume>
${resume}
</resume>

<approved_changes>
${JSON.stringify(approvedClaims, null, 2)}
</approved_changes>

<my_answers>
${answers || "(none)"}
</my_answers>

Output ONLY the final resume in clean plain text (CAPS section headers, "-" bullets). No commentary, no placeholders — this file will be submitted to employers as-is.`,
    }),
  },

  // ---------- Auto-apply preparation ----------
  prepare_application: {
    mode: "json",
    maxTokens: 8000,
    build: ({ resume, job, portal }) => ({
      system: SYSTEM_BASE,
      user: `Prepare my complete application for this job so I can submit it on ${portal} in under two minutes.

<job>
${JSON.stringify(job, null, 2)}
</job>

<resume>
${resume}
</resume>

Produce:
- coverLetter: a tight, specific cover letter (150-220 words) referencing the company and role. No clichés.
- tailoredHighlights: 4-5 resume bullet points re-angled for THIS job (ready to paste).
- screeningAnswers: 4-6 likely screening questions on ${portal} for this role (notice period, expected CTC, experience with X, why this company) each with a strong ready-to-paste answer. For CTC/notice period use sensible placeholders in [brackets] for me to fill.`,
    }),
    schema: obj({
      coverLetter: str,
      tailoredHighlights: strArr,
      screeningAnswers: { type: "array", items: obj({ question: str, answer: str }) },
    }),
  },

  // ---------- Mock interview ----------
  interview_turn: {
    mode: "stream",
    tier: "fast", // one short question per turn, latency matters
    maxTokens: 4000,
    build: ({ mode, history, resume, stage }) => ({
      system: `${SYSTEM_BASE}

You are now conducting a realistic ${mode === "video" ? "video" : "oral"} mock interview for a frontend developer position. You are the interviewer — professional, probing, realistic (like a real Indian tech company + occasional global-style questions). Rules:
- ONE question at a time. Keep your turns short (2-4 sentences max).
- Mix: intro/behavioral, JavaScript/TypeScript fundamentals, React/Redux, CSS/layout, practical scenarios from real work (they worked on Mera Monitor).
- React to the candidate's previous answer briefly (one sentence — acknowledge or push back) before the next question.
- Increase difficulty gradually. Stage: ${stage || "start"}.`,
      user: `Candidate resume:
<resume>
${resume}
</resume>

Interview so far:
${history || "(not started — greet briefly and ask the first question)"}

Give your next interviewer turn only.`,
    }),
  },

  interview_feedback: {
    mode: "stream",
    maxTokens: 8000,
    build: ({ history }) => ({
      system: SYSTEM_BASE,
      user: `The mock interview is over. Here is the full transcript:

${history}

Give me a frank performance report:
1. Overall score /10 and hire-signal (Strong Hire / Hire / Borderline / No Hire)
2. What I did well (specific quotes)
3. What hurt me (specific quotes + what a strong answer would have been)
4. Communication & structure feedback
5. Top 3 things to drill before the real interview`,
    }),
  },

  // ---------- Practice (mirrors real frontend interview rounds) ----------
  practice_question: {
    mode: "json",
    tier: "standard",
    maxTokens: 8000,
    build: ({ topic, difficulty, seen, format }) => ({
      system: `${SYSTEM_BASE}

Real frontend interviews are overwhelmingly practical: a 45-60 minute pair-programming round building something small but real — fetch an API and render a filterable, sortable list; handle loading and error states; a debounced search; an accessible modal; a paginated table. Interviewers watch component decomposition, state modelling, edge-case handling, and how the candidate handles ambiguity. Algorithm puzzles are a much smaller part of the loop for this role.`,
      user: `Generate one ${difficulty || "Medium"} ${
        format === "algorithm"
          ? "algorithm-style question (a pure function, no UI)"
          : "practical component-building question, the kind asked in a live frontend pair-programming round"
      } for a frontend developer interview.

Topic preference: ${topic || "React components, hooks, async data"}.
Avoid these already-seen titles: ${seen || "(none)"}.

It must be answerable in one code textarea with no test runner or preview, so ${
        format === "algorithm"
          ? "a pure function is right."
          : "ask for a single React component (hooks allowed, no imports beyond React) and describe the required UI behaviour precisely enough that the code can be judged by reading it."
      }

- "description": the problem, naming the edge cases you expect handled (empty, loading, error, rapid input).
- "starterCode": a skeleton with the exact signature/props and a comment stating required behaviour.
- "examples": 2-3 lines of expected behaviour — for a component describe UI states, not input→output.
- "hints": 2-3 progressive hints.`,
    }),
    schema: obj({
      title: str,
      difficulty: str,
      topic: str,
      description: str,
      examples: strArr,
      hints: strArr,
      starterCode: str,
    }),
  },

  review_solution: {
    mode: "json",
    maxTokens: 8000,
    build: ({ question, code }) => ({
      system: SYSTEM_BASE,
      user: `Review my solution to this interview question.

<question>
${JSON.stringify(question, null, 2)}
</question>

<my_solution>
${code}
</my_solution>

Judge correctness by mentally executing it against the examples and edge cases. verdict: "Accepted" only if fully correct. score: 0-100. feedback: what's wrong/right, edge cases missed, style notes. complexity: time/space of MY solution. optimalSolution: clean optimal JS code with brief inline comments.`,
    }),
    schema: obj({
      verdict: str,
      score: int,
      feedback: str,
      complexity: str,
      optimalSolution: str,
    }),
  },

  // ---------- HR outreach email ----------
  compose_email: {
    mode: "json",
    maxTokens: 8000,
    build: ({ mode, role, company, toEmail, context, resume, profile, tone }) => ({
      system: `${SYSTEM_BASE}

You are writing a real email that will be sent from ${profile?.email || "the candidate's"} Gmail to a hiring manager or HR contact. Rules:
- Recruiters skim on a phone. Keep the body under 160 words, short paragraphs, no walls of text.
- Open with why you're writing, not "I hope this email finds you well".
- Two or three concrete proof points pulled from the resume — real projects, real technologies. Never invent experience.
- No buzzword stuffing, no "I am a passionate team player", no excessive flattery.
- Close with one clear, low-friction ask (a short call, or their thoughts on fit).
- The resume is attached as a PDF — reference it once, briefly.
- Sign off with the candidate's real name, phone and links if available.
- Plain text only. No markdown, no bullet characters unless genuinely useful (max 3 short bullets).`,
      user: `${
        mode === "reply"
          ? "Write a REPLY to the message below from a recruiter/HR."
          : "Write a cold application email to this HR/hiring contact."
      }

Role applying for: ${role || "React Developer"}
${company ? `Company: ${company}` : ""}
Recipient: ${toEmail || "(unknown)"}
Desired tone: ${tone || "professional and direct"}

${
  context
    ? `<context>\n${context}\n</context>\n(If this is a job description, mirror its key requirements using only my real experience. If it is their email to me, answer every question they asked.)`
    : "(No extra context provided — write a strong general application for this role.)"
}

<my_resume>
${resume}
</my_resume>

<my_profile>
${JSON.stringify(profile)}
</my_profile>

Return:
- "subject": a specific subject line (not "Job Application"). Include the role.
- "body": the full plain-text email, ready to send as-is, ending with my signature. No placeholders like [Your Name] — use my real details. If a fact is genuinely unknown, leave it out rather than bracketing it.
- "note": one sentence to me on what angle you took and anything I should double-check before sending.`,
    }),
    schema: obj({ subject: str, body: str, note: str }),
  },

  // ---------- Referrals ----------
  referral_plan: {
    mode: "json",
    tier: "deep",
    maxTokens: 12000,
    build: ({ job, resume, profile }) => ({
      system: `${SYSTEM_BASE}

You are helping with a referral request, which converts roughly 15× better than a cold application — referred candidates are ~30% likely to reach interview versus 1-2% for applying through a portal.

Rules that make a referral ask actually work:
- The person being asked is spending their own credibility. Make it easy and low-risk for them: short, specific, and obviously declinable.
- Never open with "I hope you're doing well" or a paragraph about yourself. Lead with the concrete ask or the specific connection.
- Reference something real and checkable — the exact role, the team, a shared technology, a project of theirs. No invented flattery.
- A referral note must be forwardable: the person should be able to paste it to their recruiter unchanged.
- LinkedIn connection notes are capped at 300 characters. Respect that hard.`,
      user: `I want a referral into this job rather than applying cold.

<job>
${JSON.stringify(job, null, 2)}
</job>

<my_resume>
${resume}
</my_resume>

<my_profile>
${JSON.stringify(profile)}
</my_profile>

Give me:
- "whoToAsk": 3-5 concrete descriptions of the kinds of people at this company most likely to refer for THIS role, most promising first. Be specific about how I'd search for them (e.g. "Frontend engineers on the payments team — search LinkedIn for 'React' + the company name, filter to 2nd-degree"). Do not invent named individuals.
- "searchQueries": 3-4 literal search strings I can paste into LinkedIn or Google to find those people.
- "connectionNote": a LinkedIn connection request, MAXIMUM 300 characters, that earns a reply.
- "referralMessage": the follow-up message once they accept — under 150 words, forwardable to their recruiter as-is.
- "coldEmail": a version to send by email if I find their address, with a subject line.
- "whyMeBullets": 3 bullets they can paste into an internal referral form, each tied to a specific requirement of this role.
- "risk": one honest sentence on how strong my case is for this specific role, including any gap that might make someone hesitate to refer me.`,
    }),
    schema: obj({
      whoToAsk: strArr,
      searchQueries: strArr,
      connectionNote: str,
      referralMessage: str,
      coldEmail: obj({ subject: str, body: str }),
      whyMeBullets: strArr,
      risk: str,
    }),
  },

  // ---------- GitHub / portfolio review ----------
  github_review: {
    mode: "json",
    tier: "deep",
    maxTokens: 12000,
    build: ({ profileData, repos, resume, profile }) => ({
      system: `${SYSTEM_BASE}

You are auditing a frontend developer's public GitHub the way a recruiter or hiring manager actually does: they open it BEFORE reading the resume, spend well under a minute, and decide whether this person ships real work. An optimised profile is worth roughly a 40% lift in callbacks.

What matters, in order: pinned repos that are obviously relevant and obviously working; READMEs with a live demo link and a screenshot; recent, honest commit activity; clean project naming. What doesn't: tutorial clones with no README, "my-first-app" naming, hundreds of stale forks, contribution-graph theatre.

Be specific and blunt. "Improve your README" is useless; "your top repo has no README, so a recruiter cannot tell in 15 seconds what it does — add a one-line description, a live URL, and a screenshot" is useful.`,
      user: `Audit my public GitHub for frontend/React roles.

<github_profile>
${JSON.stringify(profileData, null, 2)}
</github_profile>

<repositories>
${JSON.stringify(repos, null, 2)}
</repositories>

<my_resume>
${resume}
</my_resume>

<my_profile>
${JSON.stringify(profile)}
</my_profile>

Return:
- "verdict": one honest sentence on the impression this profile gives a recruiter in under a minute.
- "score": 0-100. Be strict — a profile with no pinned repos, no READMEs and no live demos should score under 40.
- "quickWins": 3-5 changes I could make TODAY, each with the specific repo name and the exact thing to do.
- "repoAdvice": for my most relevant repos, what to fix. Each: repo (exact name), issue, fix.
- "profileReadme": a complete GitHub profile README (markdown) I can paste into a repo named after my username — real content from my actual experience, no placeholders.
- "projectIdeas": 2-3 projects that would genuinely strengthen my case for the roles I'm targeting, each with why it lands and roughly how long it takes.`,
    }),
    schema: obj({
      verdict: str,
      score: int,
      quickWins: strArr,
      repoAdvice: {
        type: "array",
        items: obj({ repo: str, issue: str, fix: str }),
      },
      profileReadme: str,
      projectIdeas: {
        type: "array",
        items: obj({ title: str, why: str, effort: str }),
      },
    }),
  },

  // ---------- Inbox triage ----------
  classify_inbox: {
    mode: "json",
    tier: "fast", // bucketing email; runs ~27× per sync
    maxTokens: 8000,
    build: ({ emails, profile }) => ({
      system: `${SYSTEM_BASE}

You are triaging a job-seeker's inbox. Be decisive and accurate — they rely on this instead of reading Gmail themselves. Categories:
- "applied_reply": a response to an application THEY submitted (interview invite, assessment link, status update, rejection, recruiter following up on their application).
- "recruiter_outreach": a recruiter or company contacting them directly about a specific opportunity — a real human reaching out, or a reply to their outreach.
- "job_alert": automated job suggestions/alerts (LinkedIn, Naukri, Indeed, Instahyre digests, newsletters listing roles).
- "bulk_requirement": mass "requirement" blasts from consultancies/staffing firms — many roles, impersonal, often for other people's profiles.
- "not_job": anything else (bills, OTPs, promotions, personal, social). Mark these irrelevant.

Never invent a company or role that isn't in the email.`,
      user: `Classify each email below for ${profile?.name || "the candidate"} (target role: ${profile?.desiredRoles || "React Developer"}).

<emails>
${JSON.stringify(emails, null, 2)}
</emails>

For each email return:
- "uid": copy the uid exactly.
- "category": one of applied_reply | recruiter_outreach | job_alert | bulk_requirement | not_job
- "relevance": 0-100 — how much it matters to their job search right now. Interview invites and direct recruiter mail score highest; generic digests low; not_job = 0.
- "company": the hiring company if identifiable, else "".
- "role": the role mentioned if identifiable, else "".
- "summary": ONE short line telling them what this email actually wants. No fluff.
- "actionNeeded": true if it expects a response or a deadline-bound step.
- "suggestedAction": one of "reply" | "apply" | "schedule" | "ignore"
- "deadline": any date/time mentioned they must act by, else "".`,
    }),
    schema: obj({
      results: {
        type: "array",
        items: obj({
          uid: str,
          category: str,
          relevance: int,
          company: str,
          role: str,
          summary: str,
          actionNeeded: { type: "boolean" },
          suggestedAction: str,
          deadline: str,
        }),
      },
    }),
  },

  // ---------- Self-improvement (Evolve) ----------
  merge_strategies: {
    mode: "json",
    maxTokens: 8000,
    build: ({ current, claudeOutput, profile, stats }) => ({
      system: `${SYSTEM_BASE}

You are merging two independently written strategy documents into one. Both were written to guide an AI job-search assistant for this candidate. Your job is synthesis, not diplomacy:
- Keep the sharpest, most specific, most actionable directive when the two overlap. Never keep both versions of the same idea.
- If they contradict each other, pick the one that is better for this candidate's actual market and say why in the notes.
- Drop anything vague or generic from either source.
- The result must read as one coherent voice, not a stitched-together list.`,
      user: `Merge these into a single improved strategy.

<strategy_a_current_app>
${current || "(empty baseline)"}
</strategy_a_current_app>

<strategy_b_from_claude_pro>
${claudeOutput}
</strategy_b_from_claude_pro>

Candidate: ${JSON.stringify(profile)}
Usage so far: ${JSON.stringify(stats)}

Return:
- "systemAddendum": the merged directives, max 300 words, pure instructions with no preamble. This is injected into every future AI task.
- "notes": 3-6 bullets covering what you took from each source, what you cut, and how you resolved any conflict between them.`,
    }),
    schema: obj({ systemAddendum: str, notes: strArr }),
  },

  meta_optimize: {
    mode: "json",
    maxTokens: 8000,
    build: ({ stats, strategy, userFeedback }) => ({
      system: SYSTEM_BASE,
      user: `You can improve your own operating strategy. Current strategy addendum (injected into all your future prompts):

<current_addendum>
${strategy?.systemAddendum || "(empty — baseline)"}
</current_addendum>

Usage stats: ${JSON.stringify(stats)}
User feedback: ${userFeedback || "(none)"}

Write an improved "systemAddendum" (max 250 words) — concrete, current-best-practice directives that will make every future output better for this specific user: resume style rules that match 2026 ATS trends, Indian + global market realities for React devs, interview answer frameworks, salary negotiation angles. It must be pure instructions (no preamble). Also return "notes": 3-5 bullet points explaining what you changed in this evolution and why.`,
    }),
    schema: obj({ systemAddendum: str, notes: strArr }),
  },
};
