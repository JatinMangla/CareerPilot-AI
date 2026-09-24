#!/usr/bin/env node
/**
 * Typecheck and build, quietly.
 *
 * Two reasons this exists instead of `npm run build`:
 *  1. npm is broken on this machine (Node is an nvm symlink into another Windows
 *     account, so every npm invocation dies with EPERM). The binaries under
 *     node_modules work fine when invoked through node directly.
 *  2. A raw `next build` prints hundreds of lines of progress. Only the errors
 *     matter, so only the errors are printed.
 *
 *   node scripts/check.mjs              typecheck + token budget + unit tests + build
 *   node scripts/check.mjs --fast       skip the build
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ROOT, isMain } from "./lib/scan.mjs";

const MAX_LINES = 40;

/** Lines that are progress noise rather than a problem. */
const NOISE =
  /^\s*(?:▲|✓|✔|-|·|Creating an optimized|Collecting|Generating|Finalizing|Linting|Checking validity|Compiled|Route \(|┌|├|└|│|\+ First Load|ƒ |○ |λ |Skipping|info  -|warn  - You have enabled|$)/;

function run(label, bin, args) {
  process.stdout.write(`${label}... `);

  const started = Date.now();
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NEXT_TELEMETRY_DISABLED: "1" },
    maxBuffer: 32 * 1024 * 1024,
  });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = res.status === 0;
  console.log(ok ? `ok (${secs}s)` : `FAILED (${secs}s)`);

  if (!ok) {
    const output = `${res.stdout || ""}\n${res.stderr || ""}`
      .split("\n")
      .filter((l) => l.trim() && !NOISE.test(l));
    for (const line of output.slice(0, MAX_LINES)) console.log("   " + line);
    if (output.length > MAX_LINES) console.log(`   ...${output.length - MAX_LINES} more lines suppressed`);
  }
  return ok;
}

if (isMain(import.meta.url)) {
  const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
  const next = join(ROOT, "node_modules/next/dist/bin/next");

  for (const [bin, hint] of [
    [tsc, "typescript"],
    [next, "next"],
  ]) {
    if (!existsSync(bin)) {
      console.error(`Missing ${hint} in node_modules. Dependencies are not installed, and npm cannot run here.`);
      process.exit(1);
    }
  }

  const steps = [
    () => run("typecheck    ", tsc, ["--noEmit"]),
    () => run("token budget ", join(ROOT, "scripts/ai-cost.mjs"), ["--check"]),
    () => run("unit tests   ", join(ROOT, "scripts/test.mjs"), []),
  ];
  if (!process.argv.includes("--fast")) {
    steps.push(() => run("build        ", next, ["build"]));
  }

  let ok = true;
  for (const step of steps) ok = step() && ok;

  console.log(ok ? "\nAll checks passed." : "\nChecks failed.");
  process.exit(ok ? 0 : 1);
}
