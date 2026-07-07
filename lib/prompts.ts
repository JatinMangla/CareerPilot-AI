/**
 * Server-side task registry for /api/ai.
 * Each task defines: mode ("stream" = plain text stream, "json" = structured output),
 * a prompt builder, and (for json) an output schema enforced by the API.
 */

type TaskMode = "stream" | "json";

export interface TaskDef {
  mode: TaskMode;
  maxTokens?: number;
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
    build: ({ resume, profile, count }) => ({
      system: SYSTEM_BASE,
      user: `Based on my resume and profile, list ${count || 8} realistic, currently-plausible job openings that fit me (companies actively hiring frontend/React developers in India or remote — use well-known companies and typical current openings).

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

  // ---------- Practice (LeetCode-style, frontend-focused) ----------
  practice_question: {
    mode: "json",
    maxTokens: 6000,
    build: ({ topic, difficulty, seen }) => ({
      system: SYSTEM_BASE,
      user: `Generate one ${difficulty || "Medium"} coding question for a frontend developer interview. Topic preference: ${topic || "JavaScript / arrays / strings / React logic"}. Avoid these already-seen titles: ${seen || "(none)"}.

It should be solvable in plain JavaScript/TypeScript in a textarea (no test runner). starterCode: a JS function skeleton with a clear signature and a comment describing input/output. examples: 2-3 "Input: ... → Output: ..." lines. hints: 2-3 progressive hints.`,
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

  // ---------- Self-improvement (Evolve) ----------
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
