# CareerPilot AI

Single-user AI career copilot: resume improvement and validation, job matching, per-job
tailoring, an auto-apply pipeline, Gmail inbox triage, HR outreach, mock interviews, and a
self-evolving strategy.

**Read [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) first.** It covers the current state,
how the non-obvious systems (auth, sync, AI streaming, job scoring, outcomes) work, and the open
items. **Update its "Open items" and "Change log" whenever you finish work.**

**Read [.claude/repo-map.md](.claude/repo-map.md) before exploring.** It is generated from the
source and lists every page, API route, AI task and module with its importers. It costs ~2.7k
tokens and saves far more than that in grepping. If it looks out of date, run
`node scripts/repo-map.mjs`.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind 3 · deployed on Vercel.
The route gate is `proxy.ts` (Next 16's name for middleware, running on Node.js).
`cookies()` is async: always `await cookies()`.
API routes under `app/api/` are the entire backend — there is no separate server.
Google Gemini free tier is the **sole** AI provider.
State lives in browser localStorage, mirrored to Upstash Redis for cross-device sync.

## Commands

Run these from **either** shell:

```bash
node scripts/check.mjs                    # typecheck + token budget + unit tests + build (quiet)
node scripts/test.mjs                     # unit tests only (node --test, no framework)
node scripts/check.mjs --fast             # skip the build
node scripts/doctor.mjs                   # what is configured, and what breaks without it
node scripts/ai-cost.mjs                  # per-task AI token cost table + findings
node scripts/repo-map.mjs                 # regenerate .claude/repo-map.md
node scripts/dep-graph.mjs                # regenerate docs/dep-graph.md
node scripts/dep-graph.mjs --who lib/store.ts    # what imports one file
node scripts/tree.mjs                     # annotated tree, no node_modules
node node_modules/next/dist/bin/next dev  # run the app
```

### Toolchain facts that will otherwise cost you a turn

- **`npm` works from PowerShell but fails from bash.** bash resolves
  `/c/Program Files/nodejs/npm`, an nvm symlink into another Windows account, and dies with
  `EPERM: lstat 'C:\Users\Administrator'`. PowerShell resolves a working standalone npm.
  The binaries under `node_modules` work from both shells — prefer them.
- **Never run `next lint` / `npm run lint`.** There is no ESLint config, so it drops into an
  interactive setup prompt and hangs a non-interactive shell.
- Local node is v20; `package.json` pins `engines.node: "24.x"` for Vercel's build. Do not use
  APIs newer than Node 20 in scripts.
- `find` and `ls -R` walk `agent/node_modules` (Playwright, ~200 files). Use
  `node scripts/tree.mjs`, or the Glob/Grep tools, which respect ignores.

## Architecture

**Every AI call** goes `page → lib/aiClient.ts → POST /api/ai → lib/prompts.ts task →
lib/gemini.ts`. To add a task you touch four places: the registry entry, its `schema`, its
`tier`, and the `jsonTask`/`streamTask` call in the page. Run `node scripts/ai-cost.mjs`
afterwards — a hook enforces the token budget on every edit to `lib/prompts.ts`.

**Tiers** (`lib/gemini.ts`) are ordered model *chains*, not single models, because the free
tier's newest models are heavily contended. `fast` = classification and judging,
`standard` = most work, `deep` = text that reaches an employer.

**Caching:** JSON tasks may opt in with `cacheTtl` on their registry entry. Only idempotent
tasks — never anything the user re-clicks expecting a different answer. The cache fails open
when Redis is not configured.

## Constraints — these were decided, not overlooked

- **Gemini is the only provider.** The Anthropic path was deliberately removed. Do not
  reintroduce `@anthropic-ai/sdk`.
- **`thinkingLevel` must stay per-model.** The 2.5-era models return `400 INVALID_ARGUMENT`
  on it. Nothing in the chains is 2.5-era now — `gemini-2.5-flash` was retired mid-2026 and
  answers `404 "no longer available to new users"` for any newly created key — but the
  per-model flag is what lets an older model be pinned back into a chain safely.
- **Gemini's `responseSchema` is an OpenAPI subset.** It rejects `additionalProperties` and
  `$schema`; `toGeminiSchema` in `lib/gemini.ts` strips them. Build schemas with the `obj`
  helper in `lib/prompts.ts`.
- **Write endpoints use POST, never PUT.** This Vercel deployment returns 405 on PUT before
  the handler runs.
- **Nothing submits an application.** The agent and the UI prepare everything and then
  open each application in a tab for the user to submit. Auto-submission was removed on
  request: a sent application cannot be recalled, so a mis-parsed field becomes permanent.
  Do not add it back.
- **No bot interaction with LinkedIn / Naukri / Indeed.** Against their ToS and risks the
  user's account. The agent has a hard blocklist and only opens company ATS boards
  (Greenhouse, Lever, Ashby, Workable).
- **AI-invented job listings must never reach the apply pipeline.** `isVerifiedSource`
  gates this, and `app/jobs/page.tsx` re-stamps `id`/`url`/`source` from the fetched
  listing after scoring so the model cannot launder a guess into a verified source.
- **Paid/republisher job sites are never shown.** `BLOCKED_JOB_HOSTS` in `lib/jobFilters.ts`
  (bebee.com and friends) — they wall the application behind a payment or signup.
- **Job identity is `fingerprint()`, not `id`.** Every search mints new ids, so dedupe and
  the user's "not interested" list are both keyed on company + normalized title.
- **Email login codes need Redis.** The code hash and attempt counter live server-side
  (`lib/otp.ts`); without Upstash the code route answers 503 and password login still works.
  Sessions are revocable only with Redis (`lib/session.ts`).
- **Sync is revisioned.** Lists sync as per-item patches and merge on the server
  (`lib/syncMerge.ts`); a new list key needs an entry in `COLLECTION_ID` there.
- **Never print or commit secrets.** `.env.local` holds live credentials; `scripts/doctor.mjs`
  reports whether a variable is set without revealing it. When piping a secret to
  `vercel env add` on Windows, pipe from a file via `cmd /c` — PowerShell pipes append `\r`
  and corrupt the value.

## Deploying

`main` is connected to Vercel and auto-deploys on push (production build starts within
seconds). Running `vercel --prod` by hand is not needed.

## Conventions

- Comments explain *why*, especially where the obvious approach was tried and failed. Match
  the density already in `lib/gemini.ts` and `lib/kv.ts`.
- Every AI-facing failure needs a message a user can act on, not a stack trace.
- `node scripts/check.mjs` is the gate — keep it passing. Unit tests live in `tests/` and cover
  the pure logic (filters, fingerprint, scoring, sync merge, agent field matching). Add a test
  when you fix a bug in one of those modules. `next build` cannot reach Google Fonts from bash —
  run it from PowerShell if the build step fails with ENOTFOUND.
