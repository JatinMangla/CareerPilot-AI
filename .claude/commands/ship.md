---
description: Verify, regenerate the map, commit, and push
argument-hint: "[commit message]"
allowed-tools: Bash(node scripts/check.mjs), Bash(node scripts/repo-map.mjs), Bash(node scripts/dep-graph.mjs), Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git log:*), Read
---

Ship the current work:

1. `node scripts/check.mjs` — typecheck, token budget, build. **Stop if it fails** and fix the
   failure first.
2. `node scripts/repo-map.mjs` and `node scripts/dep-graph.mjs` — these are generated files
   and must not drift from the source within a commit.
3. `git status` and `git diff` — review what is actually staged. Never commit `.env.local`,
   `agent/apply-queue.json`, `agent/results.json`, or anything containing a credential.
4. Commit with the message in $ARGUMENTS, or write one describing *why* the change was made if
   none was given.
5. Push to `main`.

`main` is connected to Vercel and auto-deploys on push — a production build starts within
seconds. Say so after pushing; there is no need to deploy by hand.
