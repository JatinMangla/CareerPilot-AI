#!/usr/bin/env node
/**
 * PreToolUse hook for Bash — blocks the two commands that reliably waste a turn
 * on this machine, and says what to run instead.
 *
 *   npm / npx from bash   -> EPERM, because bash resolves the nvm symlink at
 *                            /c/Program Files/nodejs/npm into another Windows
 *                            account. Works from PowerShell.
 *   next lint             -> no ESLint config, so it opens an interactive setup
 *                            prompt and hangs a non-interactive shell.
 *
 * Reads the hook payload on stdin. Fails open: any parse problem exits 0 and the
 * command proceeds, because a broken hook must never block real work.
 */

import { readFileSync } from "node:fs";

function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  allow();
}

const command = payload?.tool_input?.command;
if (typeof command !== "string") allow();

/**
 * Reduce the command to the parts that actually execute.
 *
 * Heredoc bodies are file content, not commands — writing documentation that
 * mentions `npm run lint` must not be blocked. Quoted strings are stripped for
 * the same reason (`echo "run npm install later"`).
 */
function executablePart(cmd) {
  let out = cmd;
  // Drop heredoc bodies: everything from the << line's end to the delimiter line.
  for (const m of cmd.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) {
    const delim = m[2];
    const bodyStart = cmd.indexOf("\n", m.index);
    if (bodyStart === -1) continue;
    const end = cmd.indexOf(`\n${delim}`, bodyStart);
    const body = cmd.slice(bodyStart, end === -1 ? cmd.length : end);
    out = out.replace(body, "\n");
  }
  return out.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}

const bare = executablePart(command);

if (/(^|[;&|]\s*)(npm|npx)\s/.test(bare)) {
  deny(
    "npm/npx fail from bash on this machine: bash resolves /c/Program Files/nodejs/npm, " +
      "an nvm symlink into another Windows account, so it exits with " +
      "EPERM lstat 'C:\\Users\\Administrator'.\n\n" +
      "Use instead:\n" +
      "  node scripts/check.mjs                      (typecheck + token budget + build)\n" +
      "  node node_modules/next/dist/bin/next build  (build only)\n" +
      "  node node_modules/next/dist/bin/next dev    (run the app)\n" +
      "  node node_modules/typescript/bin/tsc --noEmit\n\n" +
      "If you genuinely need npm itself (installing a dependency), run it through the " +
      "PowerShell tool instead, where it resolves to a working standalone npm."
  );
}

// Only an actual invocation: `next lint`, `npm run lint`, `yarn lint`.
if (/\bnext\s+lint\b/.test(bare) || /\b(npm|pnpm|yarn)\s+(run\s+)?lint\b/.test(bare)) {
  deny(
    "This repo has no ESLint config, so `next lint` drops into an INTERACTIVE setup prompt " +
      "and hangs a non-interactive shell.\n\n" +
      "Use `node scripts/check.mjs` — it runs the typecheck and token-budget gates that " +
      "actually protect this codebase."
  );
}

allow();
