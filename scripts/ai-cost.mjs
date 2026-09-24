#!/usr/bin/env node
/**
 * Token budget audit for the AI task registry.
 *
 * The app runs on Gemini's free tier — 250 calls/day (lib/quota.ts) — so input
 * tokens matter as much as output ones, and a prompt that grows silently is a
 * feature that stops working at 6pm. This measures every task in lib/prompts.ts
 * and fails the build when one regresses.
 *
 *   node scripts/ai-cost.mjs           print the table
 *   node scripts/ai-cost.mjs --check   compare against scripts/token-budget.json
 *   node scripts/ai-cost.mjs --save    record current numbers as the new budget
 *   node scripts/ai-cost.mjs --json    machine-readable output
 *
 * Estimates, not exact counts: ~4 characters per token, the standard rule of
 * thumb. Good enough to catch a prompt doubling in size; not a billing tool.
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { ROOT, read, aiTasks, TASK_DEFAULTS, isMain } from "./lib/scan.mjs";

const BUDGET_FILE = "scripts/token-budget.json";

/** ~4 chars per token. */
export const estTokens = (s) => Math.ceil((s || "").length / 4);

/**
 * Representative input, so every `build()` produces a realistic prompt rather
 * than one full of "undefined". Sized like real data: a ~4KB resume, a real job
 * description, a full profile.
 */
const FIXTURE = {
  resume:
    "JATIN MANGLA\nFrontend Developer\n\nEXPERIENCE\n- Built and shipped the Mera Monitor marketing site in React and Tailwind.\n- Cut initial bundle size 40% (2.1MB to 1.3MB) by code-splitting routes.\n- Migrated a Redux store to RTK Query, removing 900 lines of boilerplate.\n\nSKILLS\nJavaScript, TypeScript, HTML, CSS, React, Tailwind CSS, Redux, Git, Node.js\n\nEDUCATION\nB.Tech Computer Science\n".repeat(
      8
    ),
  profile: {
    name: "Jatin Mangla",
    email: "user@example.com",
    role: "Frontend Developer",
    desiredRoles: "React Developer, Frontend Engineer",
    locations: "Delhi NCR / Remote (India)",
    skills: ["JavaScript", "TypeScript", "React", "Tailwind CSS", "Redux", "Git", "Node.js"],
    noticePeriod: "30 days",
    expectedCtc: "12 LPA",
    linkedin: "https://linkedin.com/in/example",
    github: "https://github.com/example",
    portfolio: "",
  },
  job: {
    id: "j1",
    title: "React Developer",
    company: "Acme",
    location: "Remote, India",
    url: "https://boards.greenhouse.io/acme/jobs/1",
    description:
      "We are looking for a React developer with 2+ years building production single-page applications. You will own feature delivery end to end, work with TypeScript and Tailwind, and collaborate with design. ".repeat(
        6
      ),
  },
  instructions: "Emphasise measurable performance work.",
  strategy: { version: 3, systemAddendum: "Lead every bullet with a metric. ".repeat(40) },
  stats: {
    improvements: 4,
    validations: 6,
    tailors: 9,
    jobsAnalyzed: 40,
    applicationsPrepared: 12,
    interviews: 3,
    practiceSolved: 15,
  },
};

/** Plausible arguments for any destructured parameter name a build() may use. */
function fixtureArg(name) {
  const f = FIXTURE;
  const map = {
    resume: f.resume,
    resumeText: f.resume,
    finalResume: f.resume,
    profile: f.profile,
    instructions: f.instructions,
    feedback: f.instructions,
    userFeedback: f.instructions,
    job: f.job,
    jobs: [f.job, f.job, f.job],
    jobDescription: f.job.description,
    description: f.job.description,
    strategy: f.strategy,
    stats: f.stats,
    emails: Array.from({ length: 12 }, (_, i) => ({
      uid: String(i),
      from: "recruiter@acme.com",
      subject: "React Developer opening at Acme",
      date: "2026-09-01",
      snippet: "Hi Jatin, we came across your profile and think you would be a great fit. ".repeat(3),
    })),
    validation: { overallScore: 72, atsScore: 68, categories: [], missingKeywords: ["Next.js"] },
    github: { score: 34, publicRepos: 15, verdict: "Thin" },
    funnel: { applied: 20, replied: 2, interviews: 1, offers: 0 },
  };
  if (name in map) return map[name];
  if (/s$/.test(name)) return [];
  return "sample value";
}

/**
 * Build every task's prompt with fixture input.
 *
 * lib/prompts.ts is TypeScript, and there is no TS runtime here (no ts-node,
 * and npm cannot install one). So the file is transpiled by stripping types —
 * crude, but the module is plain data plus template literals, which survives it.
 */
async function loadTasks() {
  let src = read("lib/prompts.ts");

  src = src
    .replace(/^import\s+type[^;]+;$/gm, "")
    .replace(/^(?:export\s+)?interface\s+\w+[^{]*\{[\s\S]*?^\}$/gm, "")
    .replace(/^(?:export\s+)?type\s+\w+(?:<[^>]*>)?\s*=[\s\S]*?;$/gm, "")
    .replace(/\s+as\s+const/g, "")
    .replace(/:\s*Record<[^>]+>\s*=/g, " =")
    .replace(/\(\s*input:\s*Record<[^>]+>\s*\)/g, "(input)")
    .replace(/properties:\s*Record<[^>]+>/g, "properties")
    // Whole parameter lists of top-level function declarations:
    // `function fence(tag: string, content: unknown)`. Generics are removed first,
    // so the comma inside `Record<string, any>` is not taken for a separator.
    .replace(/^((?:export\s+)?function\s+\w+\s*)\(([^)]*)\)/gm, (_, head, params) => {
      let p = params;
      while (/<[^<>]*>/.test(p)) p = p.replace(/<[^<>]*>/g, "");
      return `${head}(${p
        .split(",")
        .map((s) => s.replace(/\??\s*:[\s\S]*$/, ""))
        .join(",")})`;
    })
    // Parameter annotations, optional or not: `(profile?: Partial<Profile>)`.
    .replace(/([A-Za-z_$][\w$]*)\?\s*:\s*[\w.<>[\]|\s]+?(?=[,)])/g, "$1")
    // Return type annotations: `): string {`.
    .replace(/\)\s*:\s*[\w.<>[\]|]+\s*\{/g, ") {")
    .replace(/:\s*any\b/g, "");

  // Via a temp file rather than a data: URL — a syntax error in a data: URL makes
  // Node print the entire base64 blob instead of a line number.
  const tmp = join(tmpdir(), `cp-prompts-${process.pid}.mjs`);
  writeFileSync(tmp, src, "utf8");
  try {
    return (await import(pathToFileURL(tmp).href)).tasks;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Parameter names a build() destructures, so fixtures can be shaped for it. */
function paramsOf(fn) {
  const m = /^\s*(?:async\s*)?\(?\s*\{([^}]*)\}/.exec(fn.toString());
  if (!m) return [];
  return m[1]
    .split(",")
    .map((p) => p.split(/[:=]/)[0].trim())
    .filter(Boolean);
}

export async function measure() {
  const meta = new Map(aiTasks().map((t) => [t.name, t]));
  const tasks = await loadTasks();
  const rows = [];

  for (const [name, def] of Object.entries(tasks)) {
    const info = meta.get(name) ?? { tier: def.tier ?? "standard", cacheTtl: null, calledFrom: [] };
    const args = Object.fromEntries(paramsOf(def.build).map((p) => [p, fixtureArg(p)]));

    let system = "";
    let user = "";
    let error = null;
    try {
      ({ system, user } = def.build(args));
    } catch (err) {
      error = err.message;
    }

    const maxTokens = def.maxTokens ?? TASK_DEFAULTS[def.mode] ?? 8000;
    rows.push({
      name,
      mode: def.mode,
      tier: def.tier ?? "standard",
      systemTokens: estTokens(system),
      userTokens: estTokens(user),
      inputTokens: estTokens(system) + estTokens(user),
      maxTokens,
      schema: Boolean(def.schema),
      cacheTtl: def.cacheTtl ?? null,
      calledFrom: info.calledFrom ?? [],
      error,
    });
  }

  rows.sort((a, b) => b.inputTokens - a.inputTokens);
  return rows;
}

/**
 * Advice worth acting on, not a lint of everything imaginable.
 *
 * Deliberately NOT flagged: a large `maxTokens`. It is a ceiling, not an
 * allocation — Gemini only generates what the answer needs, and the free tier
 * meters requests per day rather than tokens. Lowering it saves nothing and
 * risks the truncated-JSON failure this codebase has already been bitten by.
 * Input tokens are the ones re-spent on every single call, so those are what
 * this measures.
 */
export function findings(rows) {
  const out = [];
  const cacheable = ["validate_resume", "analyze_jobs", "classify_inbox", "github_review"];

  for (const r of rows) {
    if (r.error) out.push(`${r.name}: build() threw — ${r.error}`);

    // app/api/ai/route.ts does `def.schema!` for json mode — no schema is a crash.
    if (r.mode === "json" && !r.schema) {
      out.push(`${r.name}: json mode with no schema — /api/ai asserts one and will throw`);
    }
    if (r.mode === "stream" && r.cacheTtl) {
      out.push(`${r.name}: cacheTtl on a stream task — streams are never cached, so this does nothing`);
    }
    if (r.tier === "deep" && r.mode === "json" && !r.schema) {
      out.push(`${r.name}: deep tier without a schema — deep is for text that reaches an employer`);
    }
    if (cacheable.includes(r.name) && !r.cacheTtl) {
      out.push(`${r.name}: idempotent but not cached — set cacheTtl to stop re-spending quota on an identical answer`);
    }

    // Tasks invoked once per item pay their whole input on every iteration.
    if (r.inputTokens > 1500 && r.calledFrom.length && !r.cacheTtl) {
      out.push(
        `${r.name}: ~${r.inputTokens} input tokens per call and not cached — check whether ` +
          `${r.calledFrom.join(", ")} calls it in a loop, which multiplies that cost per item`
      );
    }
  }

  const shared = rows.length ? Math.min(...rows.map((r) => r.systemTokens)) : 0;
  if (shared > 250) {
    out.push(`the shared system prompt is ~${shared} tokens and is re-sent on all ${rows.length} tasks`);
  }
  return out;
}

function table(rows) {
  const head = ["task", "mode", "tier", "sys", "user", "in", "maxOut", "cache"];
  const body = rows.map((r) => [
    r.name,
    r.mode,
    r.tier,
    String(r.systemTokens),
    String(r.userTokens),
    String(r.inputTokens),
    String(r.maxTokens),
    r.cacheTtl ? r.cacheTtl + "s" : "-",
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

if (isMain(import.meta.url)) {
  const rows = await measure();
  const budgetPath = join(ROOT, BUDGET_FILE);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  }

  if (process.argv.includes("--save")) {
    const budget = Object.fromEntries(rows.map((r) => [r.name, { inputTokens: r.inputTokens, maxTokens: r.maxTokens }]));
    writeFileSync(budgetPath, JSON.stringify({ tolerance: 0.15, tasks: budget }, null, 2) + "\n", "utf8");
    console.log(`Saved budget for ${rows.length} tasks to ${BUDGET_FILE}`);
    process.exit(0);
  }

  if (process.argv.includes("--check")) {
    if (!existsSync(budgetPath)) {
      console.error(`No budget recorded. Run: node scripts/ai-cost.mjs --save`);
      process.exit(1);
    }
    const { tolerance = 0.15, tasks: budget } = JSON.parse(readFileSync(budgetPath, "utf8"));
    const problems = [];

    for (const r of rows) {
      if (r.error) problems.push(`${r.name}: build() threw — ${r.error}`);
      const b = budget[r.name];
      if (!b) {
        problems.push(`${r.name}: new task with no recorded budget — run --save to accept it`);
        continue;
      }
      const ceiling = Math.ceil(b.inputTokens * (1 + tolerance));
      if (r.inputTokens > ceiling) {
        problems.push(
          `${r.name}: input grew ${b.inputTokens} -> ${r.inputTokens} tokens (+${Math.round(
            (r.inputTokens / b.inputTokens - 1) * 100
          )}%, ceiling ${ceiling})`
        );
      }
    }
    for (const name of Object.keys(budget)) {
      if (!rows.some((r) => r.name === name)) problems.push(`${name}: in the budget but no longer in the registry`);
    }

    if (problems.length) {
      console.error("Token budget check FAILED:\n" + problems.map((p) => "  - " + p).join("\n"));
      console.error("\nIf the growth is intended: node scripts/ai-cost.mjs --save");
      process.exit(1);
    }
    console.log(`Token budget OK — ${rows.length} tasks within ${Math.round(tolerance * 100)}% of recorded input size.`);
    process.exit(0);
  }

  const total = rows.reduce((n, r) => n + r.inputTokens, 0);
  console.log(table(rows));
  console.log(
    `\n${rows.length} tasks · ${total} input tokens if every task ran once · estimate at ~4 chars/token with representative input`
  );

  const notes = findings(rows);
  if (notes.length) {
    console.log("\nFindings:");
    for (const n of notes) console.log("  - " + n);
  }
}
