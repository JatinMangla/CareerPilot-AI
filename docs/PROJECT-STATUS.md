# Project status and handoff

For the next Claude session (or developer) picking this up. [CLAUDE.md](../CLAUDE.md) has the
standing rules; this file says **where the project is now, how the non-obvious systems work,
and what is still open**. Update the "Open items" and "Change log" sections whenever you finish
a piece of work, so this stays true.

_Last updated: 2026-11-01_

---

## Current state in one paragraph

The app works end to end. On 2026-09-24 an adversarial audit found four problems: a weak login
protecting Gmail access, silent data loss in sync, job matching from titles alone, and no record
of which applications produced replies. All four were fixed. A second full review on 2026-11-01
patched a critical Next.js advisory and fixed the bugs listed in the change log below. That work
is deployed (commit 96f4404); what it could not test locally is under Open items.

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
  one. The email-code routes fail closed without Redis; password login fails open. Codes also
  have a daily cap of 30, which holds an attacker to 150 guesses a day.
- More than 15 wrong codes in a day triggers an alert email to the owner.
- `/api/auth/*` is public, so its errors name no configuration and no address. Details go to
  the server log.

### Content-Security-Policy: `proxy.ts`

- The CSP is built per request around a nonce, so an injected script does not run. The root layout
  calls `await connection()`, which makes every page render per request: a prerendered page has
  no nonce and all its scripts would be blocked.
- `'wasm-unsafe-eval'` is enough for `@react-pdf`. `'unsafe-eval'` is development only.
- `connect-src` includes `data:` because `@react-pdf` fetches its WebAssembly from a data URL. It
  falls back if refused, so PDFs still work, but every export logged a CSP violation.
- `img-src` is limited to GitHub avatars. `https:` at large was a way to send data out.
- Other security headers stay in `next.config.mjs`.

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
  - A real diff made after a removal lifts the tombstone, so adding an item back on purpose
    works. A `full` upload never does. If a tombstone refuses an item, the device is sent the
    merged list instead of keeping something no other device will see.
  - A new list key needs an entry in `COLLECTION_ID`.
- **`pull()` reads local state only after its last await.** It used to read `cp_sync_dirty` before
  the download, so an edit made during the download was overwritten and never synced.
- `/api/state` accepts only `cp_*` keys that are not device-only.
- **Writes are atomic:** a Lua compare-and-set via `EVAL`. If `EVAL` fails, the route falls back
  to an unguarded write that still bumps revisions.
- **Pull is two steps:** `GET ?revs=1` (cheap), then `GET ?keys=a,b` for only the keys that moved.
- **Auth expiry:** a 401 sets sync state `expired`. The badge then shows "Session expired — sign
  in to sync" and nothing is lost. Only `configured:false` means "off".
- When another device's data lands after a page has rendered, `SyncProvider` shows a
  "Newer data arrived — Show it" banner, which remounts the page.

### AI calls: `lib/gemini.ts`, `lib/aiClient.ts`, `app/api/ai/route.ts`, `lib/prompts.ts`

- **Model fallback:** each tier is a chain of models. On a 429 the call moves to the next model
  instead of retrying. So does a 404, which is how Google retires a model, and JSON cut off by
  `MAX_TOKENS`. Non-streaming calls have a 90s timeout; streams have a 90s gap limit, because a
  total limit cut off long rewrites mid-token. The browser's abort signal cancels the upstream
  call. The API key travels in the `x-goog-api-key` header.
- **Which models:** do not add a model because it is newest. On 2026-11-01 `gemini-3.8-flash`
  timed out on 2 of 3 calls and `3.7` on 1 of 3 plus two 503s, while `3.5` answered every time in
  about 5s. Trial with three real calls first.
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
    not cached, which logs a harmless "Failed to set Next.js data cache" line per large board.
  - Board fetching stops starting new requests at 32s so the search stays inside the 60s
    function limit. Aggregator requests get 28s: JSearch takes about 15s for three pages, and at
    a 15s limit most phrasings timed out silently.
  - Lever's `allLocations` and Ashby's `secondaryLocations` are matched as well as the primary
    location, and the office that matched is the one shown.
  - `source` comes from the company (`yc-boards` when `yc: true`), not from the filter that ran.
    The boards filter includes YC jobs; the YC filter is the narrower view.
  - The response's `warnings` names any aggregator that failed or is not configured.
- **Saved list:** `pruneJobs` keeps it to 600. Anything queued, prepared or with a referral plan
  is never dropped; next go stale quick-scored listings, then the lowest value.
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
  joined. `source` and `matchScore` are stamped when the application is prepared, since the job
  may leave the list before it is sent. Marking one applied or submitted stamps `resumeVersion`
  (the resume's `updatedAt`).
- **Applied jobs:** `appliedKeys()` in `lib/today.ts` matches by fingerprint across both flows, so
  a job sent one way is not offered the other way, under any id.
- **Today:** `buildToday()` in `lib/today.ts` turns stored state into the dashboard's action list.
  It is pure and tested.
- **Dashboard:** shows the funnel plus reply rates by channel, match score band and resume
  version.
- **Inbox:** an `applied_reply` offers one-click stage updates for the matching application.
- **Evolve:** `outcomeSnapshot()` is what Evolve and the Claude strategy prompt use as evidence.

### Inbox: `app/inbox/page.tsx`, `lib/inboxFilters.ts`, `app/api/inbox/sync/route.ts`

- IMAP opens the mailbox read-only (EXAMINE) and fetches at most 200KB per message, so
  attachments are not downloaded.
- It fetches in chunks of 20 and stops starting new ones at 42s. The cursor moves only past a
  finished chunk, so any stop resumes exactly where it left off.
- `messageId` is stored so "Reply with AI" threads in the sender's conversation, and sending
  the reply marks the mail handled.
- `cp_inbox` syncs to Redis like every other list. Mail is not held only in the browser.
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

- `node scripts/check.mjs` runs typecheck, the token budget, the unit tests in `tests/`, and
  the build. Use `--fast` to skip the build.
  - `tests/gemini.test.mjs` stubs `fetch` to cover the model chain and stream trailers.
  - `next build` fails from bash with ENOTFOUND on Google Fonts; run it through PowerShell.
- Unit tests compile the pure `lib/` modules with the installed `tsc` (`--noCheck`) and run
  `node --test`. No npm install is needed.
- **Testing Redis-backed flows without prod credentials:** run a fake Upstash REST server that
  handles the commands `lib/kv.ts` uses and emulates the one CAS script. Then start
  `next start` with `UPSTASH_REDIS_REST_URL=http://localhost:<port>`.
  - This was done on 2026-09-24 and all 16 end-to-end checks passed: code lockout, single-use
    codes, per-IP limits, revocation, per-item merge, sticky removals, stale-value refusal.
  - The fake server is not committed; rebuild it from this description if needed. `EVAL` arrives
    as `[script, numkeys, key1, key2, ...args]`.
- **The sync race** can be reproduced with Playwright's `page.route`: hold `GET ?keys=` open, save
  a change, then release it. No Redis is needed.
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

## Open items

- **Not exercised on 2026-11-01:** a real Gmail read or send on imapflow 2 and nodemailer 10 (no
  local credentials; both libraries load, and the code uses only `connect`, `search`, `fetch` and
  `sendMail`), and the emailed login code path with its new daily cap (it would email the owner).
  In production: sync the inbox once, send one test email, and sign in with a code.
- **Production logs were not read.** The Vercel connector and the local CLI both lack access to the
  `jatinmanglas-projects` scope.

Versions held back on purpose:

- **`typescript` 5.9, not 7.** The 7.0 package has no `createProgram`, and `next build` calls
  `typescript.createIncrementalProgram`. Revisit when Next supports it.
- **`unpdf` pinned to 1.8.1, not 1.9+ or 2.x.** Those need the `Iterator` global from Node 22, so
  PDF upload throws on local Node 20. It would work on Vercel. Move up when local node does.

Standing notes for future work, not defects:

- **`npm audit` (dev):** the remaining advisories are all in the `vercel` CLI's own dependencies.
  It runs only on this machine and is not deployed. `npm audit --omit=dev` is the number to watch.
- **Secret rotation:** when a secret needs replacing, the Claude Code auto-mode check blocks
  Claude from writing to Vercel env ("Secret-Store Writes"). Claude generates the value into a
  file in the owner's home folder (not the OneDrive-synced Desktop), and the owner runs these
  from PowerShell:
  - `cmd /c "npx vercel env rm NAME production -y"`
  - `cmd /c "npx vercel env add NAME production < file"`
  - `npx vercel --prod`
- **Vercel CLI:** from PowerShell, `npx vercel …` sometimes dies with
  `EPERM lstat 'C:\Users\Administrator'`. `node node_modules/vercel/dist/index.js …` always
  works.

---

## Change log

### 2026-11-01: second full review

- **Dependencies:** Next 16.3.6 → 16.4.3 (critical advisory, including unauthenticated RCE), React
  19.3.1, nodemailer 10, imapflow 2, mailparser 3.14, Tailwind 3 → 4 (CSS-first; `tailwind.config.ts`
  and autoprefixer removed), Vercel CLI 65. `npm audit --omit=dev` went from 6 advisories to 0.
- **Security:** nonce CSP without `unsafe-inline` or `unsafe-eval`; `img-src` narrowed; login compares
  email and password every time (`&&` skipped the second); public auth errors no longer reveal the
  owner's address or configuration; a daily cap on login codes; a key allowlist on `/api/state`;
  read-only IMAP; a validated Message-ID before it reaches a mail header.
- **Sync data loss fixed:** the `pull()` race (reproduced: with the old order the edit was
  overwritten and never reached the server), and tombstones that refused deliberate re-adds, which
  broke "Clear list" followed by a new search.
- **AI:** retired models and truncated JSON fall through the chain; a stream that failed before its
  first token now does too; streams have a gap timeout rather than a total one; an upstream
  disconnect is no longer reported as a finished stream, which could have been saved as a resume.
- **Reach:** secondary office locations are matched; JSearch's 15s timeout, which was silently
  losing most phrasings, is now 28s; title hints are whole words ("vue" matched "Revenue"); skills
  match however a posting writes them ("Node.js (basics)" never matched before).
- **Rules that had slipped:** Apply Kits now refuses AI-researched leads, as Auto-Pilot always did.
  Auto-Pilot's tailored resume goes through `claimCheck`. Applied jobs are not offered again.
- **New:** the Today dashboard, `/profile` (moved out of Evolve, with backup download and "remove
  from this browser"), threaded email replies, job list filter, sort and posting age, PWA manifest,
  per-page titles, return to the requested page after login, source warnings on job search.
- **Fixed in passing:** follow-up reminders that could never clear; duplicate input ids on Tailor;
  the empty read-only email box on Login; Referrals showing only the first twelve jobs, unsorted;
  a YC job vanishing from its filter after a plain board search; the job list growing until
  localStorage filled; the inbox page claiming mail stayed in the browser; "rate" in a mail error
  matching "generate"; raw NUL bytes in `lib/aiCache.ts` (cache keys unchanged); `.env.local.example`
  being gitignored; the README's Anthropic and default-password instructions.
- **Design:** grouped navigation with one icon set, higher-contrast secondary text, defined `ink-500`
  and `neon-300` (used but missing, so those classes did nothing), `bg-neon-500/12` now compiles,
  visible keyboard focus, reduced-motion support, shared alert and chip classes.
- **Verified:** `check.mjs` including the build; 50 browser checks in headless Chromium with no
  console errors or CSP violations; 19 end-to-end checks through the real routes against a fake
  Upstash, with real Gemini calls and a live board search (100 listings, all with descriptions).
- **Deployed:** commit 96f4404. Checked on the live site: nonce CSP with no `unsafe-inline` or
  `unsafe-eval`, 401 from `/api/state` without a session, and the login redirect keeping `next`.

### 2026-09-26: secrets rotated

- The owner replaced `AUTH_PASSWORD` with a generated 24-character password and created a new
  Resend key, revoking the old one. Both were exposed in earlier chats.
- Redeployed. Checked: Vercel shows both variables recently updated, the latest production
  deploy is Ready, the live login page loads, and a wrong password gets 401.
- The temporary password and key files were deleted from the owner's home folder.

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
