# Project status and handoff

For the next Claude session (or developer) picking this up. [CLAUDE.md](../CLAUDE.md) has the
standing rules; this file says **where the project is now, how the non-obvious systems work,
and what is still open**. Update the "Open items" and "Change log" sections whenever you finish
a piece of work, so this stays true.

_Last updated: 2026-09-25_

---

## Current state in one paragraph

The app works end to end. On 2026-09-24 an adversarial audit found four problems:

- A weak login protecting full Gmail access.
- Several ways sync lost data silently.
- Job matching that scored listings from their title alone.
- No record of which applications produced replies.

All four were fixed and verified in one rework, described below. What remains is a Next.js
major upgrade, a real-Redis check of the sync script, and some UI consolidation (see Open items).

---

## How the non-obvious systems work

### Login and sessions: `lib/auth.ts`, `lib/otp.ts`, `lib/session.ts`, `lib/rateLimit.ts`

- **Two ways in:** an emailed 6-digit code (primary) and a password (backup). Only the owner
  (`AUTH_EMAIL`) can hold a session. There are no default credentials: production throws if
  `AUTH_EMAIL`, `AUTH_PASSWORD` or `AUTH_SECRET` is missing.
- **Email codes live in Redis:** `cp:otp:<nonce>` holds the code's hash. The browser cookie
  holds only the nonce. The attempt count is a Redis counter, capped at 5 per code, and a
  successful verify deletes the record, so each code works once.
  - Never go back to keeping the counter in a cookie. The attacker holds that cookie and can
    replay it to reset the count.
  - Without Redis, the code route answers 503 and password login still works.
- **Sessions:** the token is signed and carries `email:issuedAt:epoch`, and the route gate (`proxy.ts`) checks
  signature, age (30 days) and owner, statelessly.
  - Every data route also calls `requireSession()`. That checks two things in Redis:
    `cp:session:revoked:<sig>`, which "Sign out" sets for one session, and
    `cp:session:epoch`, which "Sign out everywhere" bumps to end every session.
  - Revocation only works when Redis is configured.
- **Rate limits:** `rateLimitPair()` applies a per-IP bucket (from `x-real-ip`) and a global
  one. The email-code routes fail closed without Redis; password login fails open.
- More than 15 wrong codes in a day triggers an alert email to the owner.

### Cross-device sync: `lib/store.ts` (browser), `app/api/state/route.ts`, `lib/syncMerge.ts`, `lib/kv.ts`

- localStorage is the instant cache. Every write stamps the key and adds it to a **persisted**
  dirty set (`cp_sync_dirty`), then schedules a push.
- The server keeps a **revision number per key** in the `careerpilot:rev` hash, next to the
  `careerpilot:state` hash.
  - A push sends each key's `baseRev`, the revision this device last synced.
  - An up-to-date device fast-forwards. A real conflict on a whole value is decided by
    timestamp, and timestamps more than 60s in the future are clamped to server time.
- **Lists** are the keys in `COLLECTION_ID`: jobs, dismissed, apps, queue, emails, referrals,
  inbox.
  - They are sent as **patches** (changed items plus removed ids), diffed against the item
    hashes stored at the last sync (`cp_sync_base`).
  - The server applies the patch to whatever it holds, so two devices editing different items
    both survive. Removals leave tombstones for 60 days.
  - A new list key needs an entry in `COLLECTION_ID`.
- **Writes are atomic:** a Lua compare-and-set via `EVAL`. If `EVAL` fails, the route falls back
  to an unguarded write that still bumps revisions.
- **Pull is two steps:** `GET ?revs=1` (cheap), then `GET ?keys=a,b` for only the keys that moved.
- **Auth expiry:** a 401 sets sync state `expired`. The badge then shows "Session expired — sign
  in to sync" and nothing is lost. Only `configured:false` means "off".
- When another device's data lands after a page has rendered, `SyncProvider` shows a
  "Newer data arrived — Show it" banner, which remounts the page.

### AI calls: `lib/gemini.ts`, `lib/aiClient.ts`, `app/api/ai/route.ts`, `lib/prompts.ts`

- **Model fallback:** each tier is a chain of models. On a 429 the call moves to the next model
  instead of retrying. Every call has a 90s timeout, and the browser's abort signal cancels
  the upstream call. The API key travels in the `x-goog-api-key` header.
- **Stream trailer:** every stream ends with one marker, which `streamTask` strips.
  - `[[CP_META:{model,fallback,finish}]]` ends a normal stream.
  - `[[CP_ERROR:msg]]` ends a failed one.
  - If `finish` is anything but `STOP`, or the marker is missing, `IncompleteStreamError` is
    thrown. The resume and tailor pages refuse to save incomplete text.
  - Conversational tasks (interview) pass `allowIncomplete`.
- **Which model answered:** JSON responses carry `x-ai-model`, `x-ai-fallback` and `x-ai-usage`.
  The usage count is every upstream Gemini call, counted in Redis per Pacific-time day. The
  usage banner warns but no longer hard-stops, because Gemini's own 429 is the real limit.
- **Prompts:**
  - Every task receives the profile and builds its system prompt with `systemBase(profile)`,
    which includes `yearsExperience`. Don't reintroduce hardcoded identity.
  - Third-party text goes through `fence(tag, text)` as `<untrusted_*>`.
  - Fixed-value fields use `oneOf(...)` enums.
  - The strategy addendum is capped at 6,000 chars.
- **Checking what the AI added:** `lib/claimCheck.ts` lists numbers and technologies that appear
  in AI output but not in the source resume. PDF export asks for confirmation while
  `[confirm]` markers remain.

### Job pipeline: `app/api/jobs/route.ts`, `lib/companyBoards.ts`, `lib/jobFilters.ts`, `lib/jobScore.ts`, `app/jobs/page.tsx`

- **Sources:** 121 company boards (Greenhouse, Lever, Ashby) plus JSearch and Adzuna.
  - Board lists are cached for 30 min through Next's fetch data cache; responses over 2MB are
    not cached.
  - Board fetching stops starting new requests at 32s so the search stays inside the 60s
    function limit.
- **Descriptions:** Lever and Ashby descriptions come in the list. Greenhouse descriptions are
  fetched per job, for the shortlist only. `jdExcerpt` keeps the requirements part.
- **Matching:**
  - `matchesRole(title, terms, years)`: generic words ("developer", "engineer") no longer admit
    titles, and staff/principal roles need 8+ years.
  - `fingerprint()` keeps the level ("Sr" = "Senior", "2" = "II") and strips company legal
    suffixes. Dismissals are compared by re-fingerprinting their stored title and company.
  - `INDIA_RE` is word-bounded, and city aliases (Bangalore/Bengaluru and others) apply.
- **Scoring:** every listing gets `quickScore()` with no AI call (`aiScored: false`). The top 40
  go to `analyze_jobs` in batches of 20, and that task returns only its judgement, keyed by id.
  "Analyze N more with AI" covers the rest.
  - A failed search shows an error. AI-invented leads (`find_jobs`) appear only when the user
    clicks for them.

### Outcomes loop: `lib/outcomes.ts`

- **What is recorded:** Apply Kits (`cp_apps`) and Auto-Pilot (`cp_queue`) applications are
  joined. Marking one applied or submitted stamps `source`, `matchScore` and `resumeVersion`
  (the resume's `updatedAt`).
- **Dashboard:** shows the funnel plus reply rates by channel, match score band and resume
  version.
- **Inbox:** an `applied_reply` offers one-click stage updates for the matching application.
- **Evolve:** `outcomeSnapshot()` is what Evolve and the Claude strategy prompt use as evidence.

### Inbox: `app/inbox/page.tsx`, `lib/inboxFilters.ts`, `app/api/inbox/sync/route.ts`

- IMAP fetch is capped at 200KB per message, so attachments are not downloaded.
- `isTransactional()` files bank, OTP and receipt mail locally without sending it to the AI.
  Anything that mentions a job is never filtered this way.
- Mail that has already been classified is never re-sent. `trimForStorage` caps storage at 800
  messages; non-job mail keeps no body.
- Only sender, subject and a 300-char snippet go to `classify_inbox`.

### Playwright agent: `agent/`

- It fills forms and never submits them.
- It walks every frame, which covers Greenhouse forms embedded in an iframe.
- `isBlocked()` checks the given URL and the post-redirect URL, including in `--open` mode.
- Field matching (`agent/fields.mjs`):
  - Trap labels are left for the user: "Rate your proficiency", "Mobile development",
    "Referrer's email", "Current CTC", and country-specific work authorisation.
  - `pickOption()` does whole-word, prefix and numeric-range dropdown matching.
- `agent/test-fixture.html` contains those traps plus an iframe.

---

## Verification tooling

- `node scripts/check.mjs` runs typecheck, the token budget, the 28 unit tests in `tests/`, and
  the build. Use `--fast` to skip the build.
  - `next build` fails from bash with ENOTFOUND on Google Fonts; run it through PowerShell.
- Unit tests compile the pure `lib/` modules with the installed `tsc` (`--noCheck`) and run
  `node --test`. No npm install is needed.
- **Testing Redis-backed flows without prod credentials:** run a fake Upstash REST server that
  handles the commands `lib/kv.ts` uses and emulates the one CAS script. Then start
  `next start` with `UPSTASH_REDIS_REST_URL=http://localhost:<port>`.
  - This was done on 2026-09-24 and all 16 end-to-end checks passed: code lockout, single-use
    codes, per-IP limits, revocation, per-item merge, sticky removals, stale-value refusal.
  - The fake server is not committed; rebuild it from this description if needed.
- **Browser checks without installing anything:** `agent/node_modules` already has Playwright.
  1. Build via PowerShell.
  2. Run `next start -p 3123`.
  3. Load `playwright` with `createRequire("…/agent/package.json")`.
  4. Log in through `POST /api/auth/login` (password from `.env.local`, never printed), then drive
     pages. Pages render client-side behind `SyncProvider`, so wait for `main h1` or a role
     before asserting.
  - A plain curl of a page only ever shows the "Syncing your data…" loader.

## Gotchas that cost time

- **Shell escaping corrupts source.** Don't edit code that contains escapes through bash
  heredocs or `node -e`. `\b` became a backspace byte and `\n` a real newline. Use the
  Edit/Write tools; the unit tests caught one such corruption.
- **npm:** it works only through PowerShell (`powershell.exe -NoProfile -Command '...'`). See
  CLAUDE.md.
- **`agent/results.json` and `agent/screenshots/`** hold the user's real application data and are
  gitignored. Back them up before running the agent against the fixture, and restore them after.
- **`scripts/ai-cost.mjs`** strips TypeScript with regexes to load `lib/prompts.ts`. It handles
  typed parameters of top-level `function` declarations, but not typed arrow-function params
  inside the registry. Prefer `function` declarations for helpers in that file.

---

## Open items (highest value first)

The remaining item needs an action only the owner can take. The Claude Code auto-mode safety
check blocks Claude from writing production secrets, even with the owner's verbal approval.

1. **Rotate `AUTH_PASSWORD` and the Resend key.** Both were exposed in earlier chats or notes.
   - **Password:** a new random password is already generated in
     `C:\Users\jmangla.AAPNAINFOTECH\careerpilot-new-password.txt`, in the home folder, which
     OneDrive does not sync.
     - The auto-mode check blocked writing it to Vercel ("Secret-Store Writes").
     - The owner runs, from the repo:
       - `cmd /c "npx vercel env rm AUTH_PASSWORD production -y"`
       - `cmd /c "npx vercel env add AUTH_PASSWORD production < C:\Users\jmangla.AAPNAINFOTECH\careerpilot-new-password.txt"`
     - Then redeploy: push any commit, or run `npx vercel --prod`. Env changes apply only to new
       deployments.
     - Then store the password somewhere safe and delete the file.
   - **Resend:** create a new key in the Resend dashboard, then replace `RESEND_API_KEY` the same
     way.
2. Security-headers CSP still allows `'unsafe-inline'` and `'unsafe-eval'`. `@react-pdf` needs
   eval, and a nonce would force dynamic rendering. This is a deliberate trade-off.
   - On 2026-09-25 PDF export was verified working under this CSP in a real browser.

---

## Change log

### 2026-09-25 (later): Next.js 16 and React 19

- **Upgrade:** Next 14.2.35 → 16.3.6 and React 18 → 19.3. The owner ran the install; the code
  changes were done here.
  - `cookies()` is awaited everywhere: the auth routes and `lib/session.ts`.
  - `middleware.ts` → `proxy.ts`, exporting `proxy`; it runs on Node.js.
  - `experimental.serverComponentsExternalPackages` → `serverExternalPackages`.
  - Next rewrote `tsconfig.json` with `jsx: react-jsx`; keep that.
  - `scripts/repo-map.mjs` and `scripts/dep-graph.mjs` understand `proxy.ts`.
- **Result:** `npm audit --omit=dev` now reports **0** vulnerabilities (it was 1 critical and
  1 high).
- **Verified on the Next 16 build:**
  - security headers, 401s and the login redirect;
  - password login, tamper rejection and logout;
  - PDF upload;
  - 16 of 16 fake-Redis end-to-end checks;
  - a Playwright pass: all pages render, Apply tabs and redirects work, PDF export works
    under the CSP, and the tailor draft persists;
  - a live board search: 60 of 60 listings with descriptions, in 13.8s cold (it was 34s).

### 2026-09-25 (later): Apply page merge, live sync check

- **Auto-Pilot and Apply Kits merged into one page, `/apply`,** with two tabs. The tab lives in
  `?tab=pilot|kits`.
  - The flows now live in `components/apply/AutoPilot.tsx` and `components/apply/ApplyKits.tsx`.
  - The sidebar has one "Apply" entry.
  - `/autopilot` and `/auto-apply` are HTTP 307 redirects, set in `next.config.mjs` `redirects()`.
- **Sync compare-and-set verified on the production Upstash:** 6 of 6 checks passed, run on
  throwaway `careerpilot:test:*` keys that were deleted afterwards. The pulled credentials file
  was deleted after use.
- **Browser-tested with Playwright** (headless Chromium from `agent/node_modules`):
  - all 13 pages render with no runtime errors;
  - the Apply tabs and redirects work;
  - PDF export works under the CSP;
  - the tailor draft survives navigation.

### 2026-09-25: follow-up on the open items

- **Cancellable AI batches:** Stop buttons on Auto-Pilot, Apply Kits, Job Matches and Inbox.
  - `mapPool(items, limit, fn, onSettled, signal)` passes the signal to each call, and
    unstarted items return `skipped: true`.
  - A cancelled inbox batch does not advance the mail cursor.
  - Components: `lib/useCancellable.ts` and `components/RunProgress.tsx`.
- **Clipboard:** `lib/clipboard.ts` `copyText()` plus `components/CopyButton.tsx`. "Copied"
  appears only when the copy actually worked; failures are visible.
- **Work kept across navigation:**
  - The tailor plan, job description and answers are saved in `cp_tailor_draft`, and "Start
    over" asks first.
  - The interview transcript is saved in `cp_interview_session`.
  - Both are device-only localStorage and are not synced.
- **Interview fixes:** no double start, and "New interview" aborts the stream in flight. The
  voice toggle reads a ref, so it applies immediately, and the mic stops when an answer is sent.
- **Guards:** Practice and the GitHub audit ignore overlapping submits, and Practice confirms
  before replacing your code.
- **Accessibility:** 31 labels linked with `htmlFor`/`id`, `aria-label` on unlabelled
  textareas and selects, `aria-pressed` on toggle pills, names on icon-only buttons, and
  `aria-expanded`/`aria-current` in the nav.
- **`pdf-parse` → `unpdf`** (current pdf.js). Verified by uploading a generated PDF through the
  built app; the text came back exactly.
- **Verification on 2026-09-25:** `check.mjs` (including the build) passed; the local smoke
  tests for auth and parse-resume passed.

### 2026-09-24: adversarial audit and rework

- **Security:**
  - Server-side single-use login codes.
  - Per-IP rate limits.
  - No default credentials.
  - Constant-time compares.
  - Session revocation, with "Sign out everywhere".
  - `requireSession()` in every data route.
  - CSP, HSTS and frame headers.
  - An http(s) allowlist for links (`lib/safeUrl.ts`).
  - The repo map now honours `.gitignore`, so personal screenshots no longer leak into it.
- **Data integrity:**
  - Revisioned per-item sync.
  - A persisted dirty set.
  - An "expired" sync state.
  - A "newer data" banner.
  - Read-modify-write in the batch pages.
  - An Evolve version-race fix.
  - The inbox storage cap.
  - Streams that cannot be saved while incomplete.
- **Matching:**
  - Real job descriptions.
  - `quickScore`.
  - A slim `analyze_jobs` (about 19 calls per search down to 2).
  - `yearsExperience`.
  - Location and fingerprint fixes.
  - Board cache and search deadline.
  - No silent AI-lead fallback.
- **Outcomes:** `lib/outcomes.ts`, dashboard breakdowns, inbox → application stage links, and
  Auto-Pilot sends counted in the funnel.
- **AI:** fenced untrusted text, enums, the rule against invented metrics, `claimCheck`, header
  API key, timeouts, abort propagation, model labels, and a server-side usage count.
- **Agent:** trap-label fixes, iframe support, redirect and `--open` blocklist, `pickOption`,
  and temp-file cleanup.
- **Tooling and dependencies:**
  - Unit tests are wired into `check.mjs`.
  - Security updates: mailparser 3.9.28, nodemailer 9.1.1 and xmldom 0.8.15.
  - `@types/nodemailer` moved to devDependencies.
