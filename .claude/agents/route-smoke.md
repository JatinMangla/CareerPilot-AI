---
name: route-smoke
description: Boots the dev server, exercises the API routes, and reports which respond, which are blocked by missing configuration, and which are actually broken. Use to verify nothing regressed after changing API routes or lib/.
tools: Read, Grep, Bash, BashOutput, KillShell
model: sonnet
---

You verify the API surface actually responds. This app has no test suite, so this is the
closest thing to an integration check.

## Procedure

1. `node scripts/doctor.mjs` first. It tells you which features are unconfigured, so you can
   tell a **503 that is correct** (missing `GMAIL_APP_PASSWORD`) from a real failure. Do this
   before starting anything — it is instant and prevents chasing non-bugs.

2. Start the dev server in the background on a spare port:
   `node node_modules/next/dist/bin/next dev -p 3111`
   Wait for it to report ready before curling anything.

3. Every route is listed in `.claude/repo-map.md` with whether it needs a session cookie.
   Unauthenticated routes (`/api/auth/*`) can be hit directly. Everything else sits behind
   `middleware.ts` and returns 401 without a cookie — a 401 there is the middleware working,
   not a bug.

4. **Always kill the server** when you are done, including if you fail partway.

## Rules

- Never run `npm` from bash (EPERM — nvm symlink into another Windows account) and never run
  `next lint` (no config, opens an interactive prompt and hangs).
- Do not send real emails or submit real applications. `/api/email/send` actually sends via
  Gmail SMTP — do not exercise it with a real recipient.
- AI calls spend the user's free-tier quota (250/day). Hit `/api/ai` at most once, with a
  small task, and say that you did.

## Reporting

A table: route, status, and one of `ok` / `blocked by config (which variable)` / `BROKEN`.
For anything broken, give the error and the file:line most likely responsible. Distinguish
clearly between "correctly refusing because it is not configured" and "failing".
