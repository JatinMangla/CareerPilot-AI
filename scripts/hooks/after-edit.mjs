#!/usr/bin/env node
/**
 * PostToolUse hook — runs the cheap gate that matches whatever was just edited.
 *
 *   lib/prompts.ts   -> token budget check, so prompt bloat is caught at the
 *                       moment it is written rather than at 6pm when the free
 *                       tier runs out
 *   any source file  -> flag .claude/repo-map.md as stale
 *
 * Exit 2 feeds stderr back to Claude as feedback. Anything unexpected exits 0:
 * a hook that breaks the session is worse than a missed check.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const path = (payload?.tool_input?.file_path || "").replace(/\\/g, "/");
if (!path) process.exit(0);

const messages = [];

if (path.endsWith("lib/prompts.ts")) {
  const res = spawnSync(process.execPath, [join(ROOT, "scripts/ai-cost.mjs"), "--check"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    messages.push(
      (res.stderr || res.stdout || "").trim() ||
        "Token budget check failed. Run: node scripts/ai-cost.mjs --check"
    );
  }
}

if (/\.(ts|tsx)$/.test(path) && !path.includes("/scripts/")) {
  const res = spawnSync(process.execPath, [join(ROOT, "scripts/repo-map.mjs"), "--stale"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    messages.push(
      ".claude/repo-map.md is now stale. Before finishing, run: node scripts/repo-map.mjs && node scripts/dep-graph.mjs"
    );
  }
}

if (messages.length) {
  process.stderr.write(messages.join("\n\n") + "\n");
  process.exit(2);
}
process.exit(0);
