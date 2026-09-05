---
description: Audit AI prompt token cost per task
allowed-tools: Bash(node scripts/ai-cost.mjs), Bash(node scripts/ai-cost.mjs:*), Read, Edit
---

Run `node scripts/ai-cost.mjs` and interpret the result for this app specifically.

Context that should shape your reading: the app runs on Gemini's **free tier**, 250 calls/day.
Input tokens are re-spent on every call, so a task that runs in a loop (`classify_inbox` runs
once per 12 emails, `auto_tailor` once per job) matters far more than its single-call number
suggests.

Report the three tasks worth changing and the concrete change for each. Do not list
everything the tool printed back at the user — they can read the table.

If asked to fix something, make the edit, re-run, and show the before/after numbers.
