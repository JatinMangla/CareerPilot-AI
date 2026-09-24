#!/usr/bin/env node
/**
 * Unit tests for the pure logic, with no test framework to install.
 *
 * npm cannot install anything on this machine, so there is no Jest or Vitest.
 * Node's built-in runner (node --test, stable since Node 20) needs nothing, and
 * the installed TypeScript compiles the modules under test to plain JS first.
 *
 * Only side-effect-free modules are tested here — filters, scoring, merge
 * rules, the form-field classifier. That is where the bugs this suite was
 * written against actually lived.
 *
 *   node scripts/test.mjs
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, isMain } from "./lib/scan.mjs";

/** Modules compiled for the tests. Their own relative imports come along. */
const MODULES = [
  "lib/jobFilters.ts",
  "lib/syncMerge.ts",
  "lib/jobScore.ts",
  "lib/claimCheck.ts",
  "lib/inboxFilters.ts",
  "lib/companyBoards.ts",
  "lib/safeUrl.ts",
];

export function runTests() {
  const build = mkdtempSync(join(tmpdir(), "cp-test-"));
  try {
    const tsc = spawnSync(
      process.execPath,
      [
        join(ROOT, "node_modules/typescript/bin/tsc"),
        ...MODULES.map((m) => join(ROOT, m)),
        "--outDir", build,
        "--rootDir", join(ROOT, "lib"),
        "--module", "commonjs",
        "--target", "es2022",
        "--esModuleInterop",
        "--skipLibCheck",
        "--types", "node",
        // Types are the main typecheck's job (it sees Next's fetch extensions);
        // this build only needs JavaScript out.
        "--noCheck",
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (tsc.status !== 0) {
      console.log((tsc.stdout || "") + (tsc.stderr || ""));
      return false;
    }

    const dir = join(ROOT, "tests");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".test.mjs"))
      .map((f) => join(dir, f));
    const res = spawnSync(process.execPath, ["--test", ...files], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, CP_TEST_BUILD: build, FORCE_COLOR: "0" },
    });
    const out = `${res.stdout || ""}${res.stderr || ""}`;
    if (res.status !== 0) {
      // Failures only — the passing lines are noise.
      console.log(
        out
          .split("\n")
          .filter((l) => /not ok|fail|Error|expected|actual|at .*test\.mjs/i.test(l))
          .slice(0, 60)
          .join("\n")
      );
      return false;
    }
    const pass = /# pass (\d+)/.exec(out)?.[1];
    if (pass) console.log(`${pass} tests passed`);
    return true;
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  process.exit(runTests() ? 0 : 1);
}
