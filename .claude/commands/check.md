---
description: Typecheck, token-budget gate, and build
argument-hint: "[--fast]"
allowed-tools: Bash(node scripts/check.mjs), Bash(node scripts/check.mjs:*), Read, Edit
---

Run `node scripts/check.mjs $ARGUMENTS`.

If it passes, say so in one line. If it fails, fix the reported errors and run it again — do
not report back with a failing check unless the fix is genuinely ambiguous, in which case
explain the choice rather than guessing.

Do not substitute the package-manager equivalents: they fail from bash on this machine, and
the lint script has no config and opens an interactive prompt.
