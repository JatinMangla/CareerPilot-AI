# Repo map — CareerPilot AI

<!-- GENERATED FILE. Do not edit by hand: node scripts/repo-map.mjs -->

_86 source files · 14 pages · 11 API routes · 19 AI tasks · generated 2026-09-25_

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
|   |-- apply.mjs  (640)
|   |-- fields.mjs  (232)
|   |-- package.json
|   `-- test-fixture.html
|-- app/   # Next.js App Router — pages and API routes
|   |-- api/   # server endpoints (deploy as Vercel serverless functions)
|   |   |-- ai/
|   |   |   `-- route.ts  (131)
|   |   |-- auth/
|   |   |   |-- forgot/
|   |   |   |   `-- route.ts  (95)
|   |   |   |-- login/
|   |   |   |   `-- route.ts  (60)
|   |   |   |-- logout/
|   |   |   |   `-- route.ts  (32)
|   |   |   `-- verify/
|   |   |       `-- route.ts  (101)
|   |   |-- email/
|   |   |   `-- send/
|   |   |       `-- route.ts  (116)
|   |   |-- github/
|   |   |   `-- route.ts  (110)
|   |   |-- inbox/
|   |   |   `-- sync/
|   |   |       `-- route.ts  (182)
|   |   |-- jobs/
|   |   |   `-- route.ts  (282)
|   |   |-- parse-resume/
|   |   |   `-- route.ts  (56)
|   |   `-- state/
|   |       `-- route.ts  (181)
|   |-- apply/
|   |   `-- page.tsx  (83)
|   |-- evolve/
|   |   `-- page.tsx  (491)
|   |-- github/
|   |   `-- page.tsx  (241)
|   |-- inbox/
|   |   `-- page.tsx  (554)
|   |-- interview/
|   |   `-- page.tsx  (428)
|   |-- jobs/
|   |   `-- page.tsx  (757)
|   |-- login/
|   |   `-- page.tsx  (227)
|   |-- outreach/
|   |   `-- page.tsx  (427)
|   |-- practice/
|   |   `-- page.tsx  (269)
|   |-- referrals/
|   |   `-- page.tsx  (319)
|   |-- resume/
|   |   `-- page.tsx  (494)
|   |-- tailor/
|   |   `-- page.tsx  (351)
|   |-- validate/
|   |   `-- page.tsx  (307)
|   |-- error.tsx  (45)
|   |-- globals.css
|   |-- layout.tsx  (24)
|   `-- page.tsx  (318)
|-- components/   # shared client components
|   |-- apply/
|   |   |-- ApplyKits.tsx  (606)
|   |   `-- AutoPilot.tsx  (865)
|   |-- CopyButton.tsx  (42)
|   |-- Pager.tsx  (123)
|   |-- RunProgress.tsx  (27)
|   |-- Shell.tsx  (153)
|   |-- SyncProvider.tsx  (148)
|   `-- UsageBanner.tsx  (43)
|-- docs/   # generated documentation
|   |-- PROJECT-STATUS.md
|   `-- dep-graph.md
|-- lib/   # domain logic, AI provider, storage, auth
|   |-- pdf/   # react-pdf resume templates
|   |   `-- resumeDoc.tsx  (261)
|   |-- aiCache.ts  (61)
|   |-- aiClient.ts  (205)
|   |-- ats.ts  (215)
|   |-- auth.ts  (160)
|   |-- claimCheck.ts  (75)
|   |-- claudePrompt.ts  (110)
|   |-- clipboard.ts  (36)
|   |-- companyBoards.ts  (526)
|   |-- gemini.ts  (473)
|   |-- inboxFilters.ts  (56)
|   |-- jobFilters.ts  (242)
|   |-- jobScore.ts  (136)
|   |-- kv.ts  (271)
|   |-- mail.ts  (22)
|   |-- openTabs.ts  (51)
|   |-- otp.ts  (51)
|   |-- outcomes.ts  (212)
|   |-- pool.ts  (87)
|   |-- prompts.ts  (820)
|   |-- quota.ts  (85)
|   |-- rateLimit.ts  (79)
|   |-- roleSuggestions.ts  (88)
|   |-- safeUrl.ts  (16)
|   |-- session.ts  (64)
|   |-- stableJson.ts  (22)
|   |-- store.ts  (694)
|   |-- syncMerge.ts  (211)
|   |-- types.ts  (351)
|   `-- useCancellable.ts  (26)
|-- scripts/   # repo tooling — run with plain node, no npm
|   |-- hooks/
|   |   |-- after-edit.mjs  (63)
|   |   `-- guard-bash.mjs  (94)
|   |-- lib/   # shared scanner used by every script
|   |   `-- scan.mjs  (318)
|   |-- ai-cost.mjs  (334)
|   |-- check.mjs  (82)
|   |-- dep-graph.mjs  (165)
|   |-- doctor.mjs  (175)
|   |-- repo-map.mjs  (231)
|   |-- test.mjs  (92)
|   |-- token-budget.json
|   `-- tree.mjs  (97)
|-- tests/
|   |-- agentFields.test.mjs  (35)
|   |-- helpers.mjs  (10)
|   |-- jobFilters.test.mjs  (78)
|   |-- scoring.test.mjs  (94)
|   `-- syncMerge.test.mjs  (70)
|-- .gitignore
|-- .nvmrc
|-- CLAUDE.md
|-- README.md
|-- next.config.mjs  (59)
|-- package.json
|-- postcss.config.mjs  (10)
|-- proxy.ts  (41)
|-- tailwind.config.ts  (55)
`-- tsconfig.json
```

## Pages

| URL | File | Lines |
| --- | --- | --- |
| `/` | [app/page.tsx](../app/page.tsx) | 318 |
| `/apply` | [app/apply/page.tsx](../app/apply/page.tsx) | 83 |
| `/evolve` | [app/evolve/page.tsx](../app/evolve/page.tsx) | 491 |
| `/github` | [app/github/page.tsx](../app/github/page.tsx) | 241 |
| `/inbox` | [app/inbox/page.tsx](../app/inbox/page.tsx) | 554 |
| `/interview` | [app/interview/page.tsx](../app/interview/page.tsx) | 428 |
| `/jobs` | [app/jobs/page.tsx](../app/jobs/page.tsx) | 757 |
| `/login` | [app/login/page.tsx](../app/login/page.tsx) | 227 |
| `/outreach` | [app/outreach/page.tsx](../app/outreach/page.tsx) | 427 |
| `/practice` | [app/practice/page.tsx](../app/practice/page.tsx) | 269 |
| `/referrals` | [app/referrals/page.tsx](../app/referrals/page.tsx) | 319 |
| `/resume` | [app/resume/page.tsx](../app/resume/page.tsx) | 494 |
| `/tailor` | [app/tailor/page.tsx](../app/tailor/page.tsx) | 351 |
| `/validate` | [app/validate/page.tsx](../app/validate/page.tsx) | 307 |

## API routes

| URL | File | Auth | Talks to |
| --- | --- | --- | --- |
| `/api/ai` | [app/api/ai/route.ts](../app/api/ai/route.ts) | cookie | Gemini |
| `/api/auth/forgot` | [app/api/auth/forgot/route.ts](../app/api/auth/forgot/route.ts) | public | Upstash Redis, Resend |
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
| `auto_tailor` | json | deep | 20000 | — | `components/apply/AutoPilot.tsx` |
| `merge_claims` | stream | deep | 20000 | — | `components/apply/AutoPilot.tsx` |
| `prepare_application` | json | standard | 8000 | — | `components/apply/ApplyKits.tsx` |
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
| [components/CopyButton.tsx](../components/CopyButton.tsx) | 42 | CopyButton | 5 |
| [components/Pager.tsx](../components/Pager.tsx) | 123 | Pager, usePaged | 6 |
| [components/RunProgress.tsx](../components/RunProgress.tsx) | 27 | RunProgress | 4 |
| [components/Shell.tsx](../components/Shell.tsx) | 153 | Shell | 1 |
| [components/SyncProvider.tsx](../components/SyncProvider.tsx) | 148 | SyncBadge, SyncProvider | 1 |
| [components/UsageBanner.tsx](../components/UsageBanner.tsx) | 43 | UsageBanner | 1 |
| [components/apply/ApplyKits.tsx](../components/apply/ApplyKits.tsx) | 606 | ApplyKits | 1 |
| [components/apply/AutoPilot.tsx](../components/apply/AutoPilot.tsx) | 865 | AutoPilot | 1 |
| [lib/aiCache.ts](../lib/aiCache.ts) | 61 | cacheKey, readCache, writeCache | 1 |
| [lib/aiClient.ts](../lib/aiClient.ts) | 205 | AiMeta, IncompleteStreamError, StreamOptions, TaskOptions, jsonTask, streamTask | 13 |
| [lib/ats.ts](../lib/ats.ts) | 215 | AtsInfo, AtsKind, atsBadgeTone, detectAts, isVerifiedSource | 2 |
| [lib/auth.ts](../lib/auth.ts) | 160 | OTP_COOKIE, OTP_MAX_ATTEMPTS, SESSION_COOKIE, SESSION_MAX_AGE_MS, SessionInfo, createSessionToken, generateNonce, generateOtpCode, +6 | 7 |
| [lib/claimCheck.ts](../lib/claimCheck.ts) | 75 | ClaimReport, confirmMarkers, describeClaims, newClaims | 2 |
| [lib/claudePrompt.ts](../lib/claudePrompt.ts) | 110 | ClaudePromptInput, buildClaudeStrategyPrompt | 1 |
| [lib/clipboard.ts](../lib/clipboard.ts) | 36 | copyText | 2 |
| [lib/companyBoards.ts](../lib/companyBoards.ts) | 526 | BoardListing, COMPANY_BOARDS, CompanyBoard, htmlToText, jdExcerpt, matchesRole, searchCompanyBoards | 1 |
| [lib/gemini.ts](../lib/gemini.ts) | 473 | Generated, STREAM_ERROR, STREAM_META, Tier, geminiJson, geminiStream, geminiText, pacificDay, +1 | 1 |
| [lib/inboxFilters.ts](../lib/inboxFilters.ts) | 56 | isTransactional, trimForStorage | 1 |
| [lib/jobFilters.ts](../lib/jobFilters.ts) | 242 | BLOCKED_JOB_HOSTS, INDIA_RE, countryCode, dedupeJobs, fingerprint, isBlockedListing, matchesLocation, sourceRank | 7 |
| [lib/jobScore.ts](../lib/jobScore.ts) | 136 | QuickScore, quickScore, requiredYears | 1 |
| [lib/kv.ts](../lib/kv.ts) | 271 | casWrite, clearAll, deleteField, deleteKey, expire, getMany, getString, hgetallRaw, +10 | 7 |
| [lib/mail.ts](../lib/mail.ts) | 22 | sendOwnerMail | 2 |
| [lib/openTabs.ts](../lib/openTabs.ts) | 51 | OpenResult, TAB_BATCH, blockedHint, openTabs | 2 |
| [lib/otp.ts](../lib/otp.ts) | 51 | OTP_TTL_SEC, OtpResult, issueOtp, verifyOtp | 2 |
| [lib/outcomes.ts](../lib/outcomes.ts) | 212 | BreakdownRow, Funnel, TrackedApplication, applicationStamp, applicationsAt, breakdown, channelOf, funnelOf, +6 | 6 |
| [lib/pdf/resumeDoc.tsx](../lib/pdf/resumeDoc.tsx) | 261 | ResumeTemplate, buildLetterPdf, buildResumePdf, downloadBlob, parseResume | 5 |
| [lib/pool.ts](../lib/pool.ts) | 87 | AI_CONCURRENCY, PoolOutcome, mapPool | 4 |
| [lib/prompts.ts](../lib/prompts.ts) | 820 | SYSTEM_BASE, TaskDef, TaskTier, systemBase, tasks | 1 |
| [lib/quota.ts](../lib/quota.ts) | 85 | QuotaInfo, quota | 4 |
| [lib/rateLimit.ts](../lib/rateLimit.ts) | 79 | RateLimitResult, clientIp, rateLimit, rateLimitPair | 3 |
| [lib/roleSuggestions.ts](../lib/roleSuggestions.ts) | 88 | roleSuggestions, searchVariants | 1 |
| [lib/safeUrl.ts](../lib/safeUrl.ts) | 16 | safeHref | 4 |
| [lib/session.ts](../lib/session.ts) | 64 | currentEpoch, requireSession, revokeAllSessions, revokeSession | 10 |
| [lib/stableJson.ts](../lib/stableJson.ts) | 22 | stableStringify | 3 |
| [lib/store.ts](../lib/store.ts) | 694 | defaultProfile, defaultStats, defaultStrategy, store, sync | 17 |
| [lib/syncMerge.ts](../lib/syncMerge.ts) | 211 | COLLECTION_ID, Envelope, IncomingEntry, ListPatch, MAX_CLOCK_SKEW_MS, Resolution, TOMBSTONE_TTL_MS, Tombstones, +7 | 2 |
| [lib/types.ts](../lib/types.ts) | 351 | AutoTailorPlan, DismissedJob, ImprovementBrief, InboxCursor, InboxMessage, Job, MailCategory, OUTCOME_STAGES, +21 | 19 |
| [lib/useCancellable.ts](../lib/useCancellable.ts) | 26 | useCancellable | 4 |
| [next.config.mjs](../next.config.mjs) | 59 | — | 0 |
| [postcss.config.mjs](../postcss.config.mjs) | 10 | — | 0 |
| [proxy.ts](../proxy.ts) | 41 | config, proxy | 0 |
| [tailwind.config.ts](../tailwind.config.ts) | 55 | — | 0 |
| [tests/agentFields.test.mjs](../tests/agentFields.test.mjs) | 35 | — | 0 |
| [tests/helpers.mjs](../tests/helpers.mjs) | 10 | lib | 3 |
| [tests/jobFilters.test.mjs](../tests/jobFilters.test.mjs) | 78 | — | 0 |
| [tests/scoring.test.mjs](../tests/scoring.test.mjs) | 94 | — | 0 |
| [tests/syncMerge.test.mjs](../tests/syncMerge.test.mjs) | 70 | — | 0 |

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

