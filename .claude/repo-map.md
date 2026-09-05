# Repo map — CareerPilot AI

<!-- GENERATED FILE. Do not edit by hand: node scripts/repo-map.mjs -->

_62 source files · 15 pages · 11 API routes · 19 AI tasks · generated 2026-09-05_

**Read this before exploring.** It is regenerated from the source, so it does not drift.
For import relationships see [docs/dep-graph.md](../docs/dep-graph.md).

## What this is

Single-user AI career copilot. Next.js 14 App Router + TypeScript + Tailwind, deployed on
Vercel. API routes are the entire backend. Google Gemini (free tier) is the sole AI
provider. User state lives in browser localStorage, mirrored to Upstash Redis for
cross-device sync.

## Tree

```
.
|-- .claude/   # Claude Code project configuration
|   |-- agents/
|   |   |-- ai-task-author.md
|   |   |-- prompt-auditor.md
|   |   |-- repo-navigator.md
|   |   `-- route-smoke.md
|   |-- commands/
|   |   |-- check.md
|   |   |-- map.md
|   |   |-- ship.md
|   |   `-- tokens.md
|   |-- repo-map.md
|   `-- settings.json
|-- agent/   # local Playwright auto-apply runner (separate install)
|   |-- README.md
|   |-- apply.mjs  (547)
|   |-- fields.mjs  (154)
|   |-- package.json
|   `-- test-fixture.html
|-- app/   # Next.js App Router — pages and API routes
|   |-- api/   # server endpoints (deploy as Vercel serverless functions)
|   |   |-- ai/
|   |   |   `-- route.ts  (110)
|   |   |-- auth/
|   |   |   |-- forgot/
|   |   |   |   `-- route.ts  (98)
|   |   |   |-- login/
|   |   |   |   `-- route.ts  (43)
|   |   |   |-- logout/
|   |   |   |   `-- route.ts  (10)
|   |   |   `-- verify/
|   |   |       `-- route.ts  (77)
|   |   |-- email/
|   |   |   `-- send/
|   |   |       `-- route.ts  (113)
|   |   |-- github/
|   |   |   `-- route.ts  (106)
|   |   |-- inbox/
|   |   |   `-- sync/
|   |   |       `-- route.ts  (147)
|   |   |-- jobs/
|   |   |   `-- route.ts  (145)
|   |   |-- parse-resume/
|   |   |   `-- route.ts  (49)
|   |   `-- state/
|   |       `-- route.ts  (113)
|   |-- auto-apply/
|   |   `-- page.tsx  (471)
|   |-- autopilot/
|   |   `-- page.tsx  (625)
|   |-- evolve/
|   |   `-- page.tsx  (466)
|   |-- github/
|   |   `-- page.tsx  (243)
|   |-- inbox/
|   |   `-- page.tsx  (378)
|   |-- interview/
|   |   `-- page.tsx  (347)
|   |-- jobs/
|   |   `-- page.tsx  (312)
|   |-- login/
|   |   `-- page.tsx  (221)
|   |-- outreach/
|   |   `-- page.tsx  (405)
|   |-- practice/
|   |   `-- page.tsx  (252)
|   |-- referrals/
|   |   `-- page.tsx  (315)
|   |-- resume/
|   |   `-- page.tsx  (447)
|   |-- tailor/
|   |   `-- page.tsx  (291)
|   |-- validate/
|   |   `-- page.tsx  (306)
|   |-- error.tsx  (45)
|   |-- globals.css
|   |-- layout.tsx  (24)
|   `-- page.tsx  (276)
|-- components/   # shared client components
|   |-- Shell.tsx  (124)
|   |-- SyncProvider.tsx  (99)
|   `-- UsageBanner.tsx  (43)
|-- docs/   # generated documentation
|   `-- dep-graph.md
|-- lib/   # domain logic, AI provider, storage, auth
|   |-- pdf/   # react-pdf resume templates
|   |   `-- resumeDoc.tsx  (261)
|   |-- aiCache.ts  (61)
|   |-- aiClient.ts  (128)
|   |-- ats.ts  (179)
|   |-- auth.ts  (145)
|   |-- claudePrompt.ts  (103)
|   |-- companyBoards.ts  (213)
|   |-- gemini.ts  (335)
|   |-- kv.ts  (158)
|   |-- pool.ts  (68)
|   |-- prompts.ts  (764)
|   |-- quota.ts  (78)
|   |-- rateLimit.ts  (39)
|   |-- stableJson.ts  (22)
|   |-- store.ts  (425)
|   `-- types.ts  (295)
|-- scripts/   # repo tooling — run with plain node, no npm
|   |-- hooks/
|   |   |-- after-edit.mjs  (63)
|   |   `-- guard-bash.mjs  (94)
|   |-- lib/   # shared scanner used by every script
|   |   `-- scan.mjs  (290)
|   |-- ai-cost.mjs  (323)
|   |-- check.mjs  (81)
|   |-- dep-graph.mjs  (164)
|   |-- doctor.mjs  (175)
|   |-- repo-map.mjs  (229)
|   |-- token-budget.json
|   `-- tree.mjs  (97)
|-- .gitignore
|-- .nvmrc
|-- CLAUDE.md
|-- README.md
|-- middleware.ts  (36)
|-- next.config.mjs  (15)
|-- package.json
|-- postcss.config.mjs  (10)
|-- tailwind.config.ts  (55)
`-- tsconfig.json
```

## Pages

| URL | File | Lines |
| --- | --- | --- |
| `/` | [app/page.tsx](../app/page.tsx) | 276 |
| `/auto-apply` | [app/auto-apply/page.tsx](../app/auto-apply/page.tsx) | 471 |
| `/autopilot` | [app/autopilot/page.tsx](../app/autopilot/page.tsx) | 625 |
| `/evolve` | [app/evolve/page.tsx](../app/evolve/page.tsx) | 466 |
| `/github` | [app/github/page.tsx](../app/github/page.tsx) | 243 |
| `/inbox` | [app/inbox/page.tsx](../app/inbox/page.tsx) | 378 |
| `/interview` | [app/interview/page.tsx](../app/interview/page.tsx) | 347 |
| `/jobs` | [app/jobs/page.tsx](../app/jobs/page.tsx) | 312 |
| `/login` | [app/login/page.tsx](../app/login/page.tsx) | 221 |
| `/outreach` | [app/outreach/page.tsx](../app/outreach/page.tsx) | 405 |
| `/practice` | [app/practice/page.tsx](../app/practice/page.tsx) | 252 |
| `/referrals` | [app/referrals/page.tsx](../app/referrals/page.tsx) | 315 |
| `/resume` | [app/resume/page.tsx](../app/resume/page.tsx) | 447 |
| `/tailor` | [app/tailor/page.tsx](../app/tailor/page.tsx) | 291 |
| `/validate` | [app/validate/page.tsx](../app/validate/page.tsx) | 306 |

## API routes

| URL | File | Auth | Talks to |
| --- | --- | --- | --- |
| `/api/ai` | [app/api/ai/route.ts](../app/api/ai/route.ts) | cookie | Gemini |
| `/api/auth/forgot` | [app/api/auth/forgot/route.ts](../app/api/auth/forgot/route.ts) | public | Resend |
| `/api/auth/login` | [app/api/auth/login/route.ts](../app/api/auth/login/route.ts) | public | — |
| `/api/auth/logout` | [app/api/auth/logout/route.ts](../app/api/auth/logout/route.ts) | public | — |
| `/api/auth/verify` | [app/api/auth/verify/route.ts](../app/api/auth/verify/route.ts) | public | — |
| `/api/email/send` | [app/api/email/send/route.ts](../app/api/email/send/route.ts) | cookie | Gmail SMTP |
| `/api/github` | [app/api/github/route.ts](../app/api/github/route.ts) | cookie | GitHub API |
| `/api/inbox/sync` | [app/api/inbox/sync/route.ts](../app/api/inbox/sync/route.ts) | cookie | Gmail IMAP |
| `/api/jobs` | [app/api/jobs/route.ts](../app/api/jobs/route.ts) | cookie | Adzuna, OpenWeb Ninja |
| `/api/parse-resume` | [app/api/parse-resume/route.ts](../app/api/parse-resume/route.ts) | cookie | file parsing |
| `/api/state` | [app/api/state/route.ts](../app/api/state/route.ts) | cookie | Upstash Redis |

Write endpoints use **POST, never PUT** — this Vercel deployment returns 405 on PUT
before the handler runs.

## AI tasks

All of them run through [app/api/ai/route.ts](../app/api/ai/route.ts), which looks the task
up in [lib/prompts.ts](../lib/prompts.ts). `tier` picks the Gemini model chain in
[lib/gemini.ts](../lib/gemini.ts): `fast` = classification, `standard` = most work,
`deep` = text that reaches an employer.

| Task | Mode | Tier | Max out | Cache | Called from |
| --- | --- | --- | --- | --- | --- |
| `improve_resume` | stream | deep | 32000 | — | `app/resume/page.tsx` |
| `validate_resume` | json | standard | 8000 | 86400s | `app/validate/page.tsx` |
| `tailor_plan` | json | standard | 8000 | — | `app/tailor/page.tsx` |
| `apply_tailor` | stream | deep | 32000 | — | `app/tailor/page.tsx` |
| `find_jobs` | json | standard | 16000 | — | `app/jobs/page.tsx` |
| `analyze_jobs` | json | standard | 16000 | 21600s | `app/jobs/page.tsx` |
| `auto_tailor` | json | deep | 20000 | — | `app/autopilot/page.tsx` |
| `merge_claims` | stream | deep | 20000 | — | `app/autopilot/page.tsx` |
| `prepare_application` | json | standard | 8000 | — | `app/auto-apply/page.tsx` |
| `interview_turn` | stream | fast | 4000 | — | `app/interview/page.tsx` |
| `interview_feedback` | stream | standard | 8000 | — | `app/interview/page.tsx` |
| `practice_question` | json | standard | 8000 | — | `app/practice/page.tsx` |
| `review_solution` | json | standard | 8000 | — | `app/practice/page.tsx` |
| `compose_email` | json | standard | 8000 | — | `app/outreach/page.tsx` |
| `referral_plan` | json | deep | 12000 | — | `app/referrals/page.tsx` |
| `github_review` | json | deep | 20000 | 21600s | `app/github/page.tsx` |
| `classify_inbox` | json | fast | 8000 | 604800s | `app/inbox/page.tsx` |
| `merge_strategies` | json | standard | 8000 | — | `app/evolve/page.tsx` |
| `meta_optimize` | json | deep | 12000 | — | `app/evolve/page.tsx` |

Adding a task means touching four things: the registry entry in `lib/prompts.ts`, its
`schema` (Gemini rejects `additionalProperties` — see `toGeminiSchema`), its `tier`, and
the `jsonTask`/`streamTask` call in the page. Run `node scripts/ai-cost.mjs` after.

## Modules

| File | Lines | Exports | Imported by |
| --- | --- | --- | --- |
| [app/error.tsx](../app/error.tsx) | 45 | Error | 0 |
| [app/layout.tsx](../app/layout.tsx) | 24 | RootLayout, metadata | 0 |
| [components/Shell.tsx](../components/Shell.tsx) | 124 | Shell | 1 |
| [components/SyncProvider.tsx](../components/SyncProvider.tsx) | 99 | SyncBadge, SyncProvider | 1 |
| [components/UsageBanner.tsx](../components/UsageBanner.tsx) | 43 | UsageBanner | 1 |
| [lib/aiCache.ts](../lib/aiCache.ts) | 61 | cacheKey, readCache, writeCache | 1 |
| [lib/aiClient.ts](../lib/aiClient.ts) | 128 | TaskOptions, jsonTask, streamTask | 13 |
| [lib/ats.ts](../lib/ats.ts) | 179 | AtsInfo, AtsKind, atsBadgeTone, detectAts, isVerifiedSource | 2 |
| [lib/auth.ts](../lib/auth.ts) | 145 | OTP_COOKIE, OTP_MAX_ATTEMPTS, OtpResult, SESSION_COOKIE, bumpOtpAttempts, createOtpToken, createSessionToken, generateOtpCode, +2 | 5 |
| [lib/claudePrompt.ts](../lib/claudePrompt.ts) | 103 | ClaudePromptInput, buildClaudeStrategyPrompt | 1 |
| [lib/companyBoards.ts](../lib/companyBoards.ts) | 213 | BoardListing, COMPANY_BOARDS, CompanyBoard, matchesRole, searchCompanyBoards | 1 |
| [lib/gemini.ts](../lib/gemini.ts) | 335 | Tier, geminiJson, geminiStream, geminiText | 1 |
| [lib/kv.ts](../lib/kv.ts) | 158 | clearAll, deleteField, expire, getString, hgetallRaw, hincrbyFloat, incrWithExpiry, kvConfigured, +3 | 3 |
| [lib/pdf/resumeDoc.tsx](../lib/pdf/resumeDoc.tsx) | 261 | ResumeTemplate, buildLetterPdf, buildResumePdf, downloadBlob, parseResume | 5 |
| [lib/pool.ts](../lib/pool.ts) | 68 | AI_CONCURRENCY, PoolOutcome, mapPool | 3 |
| [lib/prompts.ts](../lib/prompts.ts) | 764 | SYSTEM_BASE, TaskDef, TaskTier, systemBase, tasks | 1 |
| [lib/quota.ts](../lib/quota.ts) | 78 | QuotaInfo, quota | 4 |
| [lib/rateLimit.ts](../lib/rateLimit.ts) | 39 | RateLimitResult, rateLimit | 3 |
| [lib/stableJson.ts](../lib/stableJson.ts) | 22 | stableStringify | 2 |
| [lib/store.ts](../lib/store.ts) | 425 | defaultProfile, defaultStats, defaultStrategy, store, sync | 16 |
| [lib/types.ts](../lib/types.ts) | 295 | AutoTailorPlan, ImprovementBrief, InboxMessage, Job, MailCategory, OUTCOME_STAGES, OutcomeStage, OutreachDraft, +19 | 15 |
| [middleware.ts](../middleware.ts) | 36 | config, middleware | 0 |
| [next.config.mjs](../next.config.mjs) | 15 | — | 0 |
| [postcss.config.mjs](../postcss.config.mjs) | 10 | — | 0 |
| [tailwind.config.ts](../tailwind.config.ts) | 55 | — | 0 |

## Commands

```bash
node scripts/check.mjs            # typecheck + token budget + build
node scripts/check.mjs --fast     # skip the build
node scripts/doctor.mjs           # which features are configured, and what breaks
node scripts/ai-cost.mjs          # per-task token cost table
node scripts/dep-graph.mjs --who lib/store.ts   # what imports one file
node scripts/repo-map.mjs         # regenerate this file
node node_modules/next/dist/bin/next dev        # run the app
```

`npm` works from PowerShell but **fails from bash** on this machine (nvm symlink into
another Windows account → `EPERM lstat 'C:\Users\Administrator'`). `next lint` has no
config and drops into an interactive prompt — do not run it.

