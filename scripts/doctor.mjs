#!/usr/bin/env node
/**
 * Toolchain and feature health check.
 *
 * Most "the app is broken" reports here are really a missing env var, and finding
 * that out costs a round trip through the UI to a 503. This maps every variable
 * to the feature it gates and says which features are actually live.
 *
 * Never prints a secret — only whether one is set, and its length.
 *
 *   node scripts/doctor.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { ROOT, isMain } from "./lib/scan.mjs";

/**
 * Which env vars each feature needs. `any` means one of the listed pairs is
 * enough (Upstash direct or Vercel's Marketplace names).
 */
const FEATURES = [
  {
    name: "AI (every task)",
    required: ["GEMINI_API_KEY"],
    breaks: "all AI features return a 500 with setup instructions",
  },
  {
    name: "Login",
    required: ["AUTH_EMAIL", "AUTH_PASSWORD", "AUTH_SECRET"],
    breaks: "AUTH_SECRET throws in production; login falls back to a dev default locally",
  },
  {
    name: "Cross-device sync + AI response cache",
    any: [
      ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
      ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ],
    breaks: "state stays on one device and the AI cache is bypassed (both fail open)",
  },
  {
    name: "Job Inbox + HR Outreach",
    required: ["GMAIL_USER", "GMAIL_APP_PASSWORD"],
    breaks: "/api/inbox/sync and /api/email/send return 503",
  },
  {
    name: "Emailed login codes",
    required: ["RESEND_API_KEY"],
    optional: true,
    breaks: "passwordless login unavailable; password login still works",
  },
  {
    name: "Wider job aggregators",
    any: [["ADZUNA_APP_ID", "ADZUNA_APP_KEY"], ["OPENWEBNINJA_API_KEY"]],
    optional: true,
    breaks: 'the "All job sites" tab falls back to company boards only',
  },
];

/** Parse .env.local for KEY=VALUE without importing a dotenv package. */
function localEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const OK = "  ok  ";
const MISS = " MISS ";
const WARN = " warn ";

if (isMain(import.meta.url)) {
  const env = { ...localEnv(), ...process.env };
  const isSet = (k) => Boolean(env[k] && env[k].length);
  const problems = [];

  console.log("Toolchain");
  console.log("---------");

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const want = pkg.engines?.node ?? "(unpinned)";
  const have = process.version;
  const majorOk = want === "(unpinned)" || have.startsWith("v" + want.split(".")[0]);
  console.log(`[${majorOk ? OK : WARN}] node ${have} (package.json engines: ${want})`);
  if (!majorOk) {
    console.log(`         local node is older than the version Vercel will build with — fine for scripts,`);
    console.log(`         but do not rely on APIs newer than ${have}.`);
  }

  /*
   * npm works from PowerShell but NOT from bash on this machine, and the reason
   * is which binary each shell finds first:
   *   bash       -> /c/Program Files/nodejs/npm  (nvm symlink into the
   *                 Administrator account -> EPERM lstat 'C:\Users\Administrator')
   *   PowerShell -> %LOCALAPPDATA%\npm-standalone\bin\npm.cmd  (works)
   * Probe both rather than asserting, so this stays honest if the box is fixed.
   */
  const probe = (cmd, args, opts) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
    return r.status === 0 && /^\d+\./.test((r.stdout || "").trim()) ? r.stdout.trim() : null;
  };
  const viaShell = probe("npm", ["-v"], { shell: true });
  const viaBash = probe("bash", ["-lc", "npm -v"], {});

  if (viaShell && !viaBash) {
    console.log(`[${WARN}] npm ${viaShell} — works from PowerShell, FAILS from bash`);
    console.log("         bash resolves /c/Program Files/nodejs/npm, an nvm symlink into another");
    console.log("         Windows account, so it dies with EPERM lstat 'C:\\Users\\Administrator'.");
    console.log("         Run npm from PowerShell, or use the binaries directly from either shell:");
    console.log("           node node_modules/next/dist/bin/next build");
    console.log("           node node_modules/typescript/bin/tsc --noEmit");
  } else if (viaShell) {
    console.log(`[${OK}] npm ${viaShell} (works from both shells)`);
  } else {
    console.log(`[${WARN}] npm unavailable — use the binaries directly:`);
    console.log("           node node_modules/next/dist/bin/next build");
    console.log("           node node_modules/typescript/bin/tsc --noEmit");
  }

  const eslint = ["eslintrc.json", ".eslintrc.json", ".eslintrc", "eslint.config.mjs", "eslint.config.js"].some((f) =>
    existsSync(join(ROOT, f))
  );
  console.log(`[${eslint ? OK : WARN}] eslint config ${eslint ? "present" : "absent"}`);
  if (!eslint) {
    console.log("         `next lint` has no config to read, so it drops into an INTERACTIVE setup");
    console.log("         prompt and hangs a non-interactive shell. Do not run it; use scripts/check.mjs.");
  }

  const deps = existsSync(join(ROOT, "node_modules/next"));
  console.log(`[${deps ? OK : MISS}] dependencies installed`);
  if (!deps) problems.push("node_modules is missing and npm cannot install it here");

  console.log("\nFeatures");
  console.log("--------");

  for (const f of FEATURES) {
    let ok;
    let detail;

    if (f.any) {
      const satisfied = f.any.find((set) => set.every(isSet));
      ok = Boolean(satisfied);
      detail = ok ? satisfied.join(" + ") : f.any.map((s) => s.join("+")).join("  or  ");
    } else {
      const missing = f.required.filter((k) => !isSet(k));
      ok = missing.length === 0;
      detail = ok ? f.required.join(", ") : "missing " + missing.join(", ");
    }

    const badge = ok ? OK : f.optional ? WARN : MISS;
    console.log(`[${badge}] ${f.name}`);
    console.log(`         ${detail}`);
    if (!ok) {
      console.log(`         without it: ${f.breaks}`);
      if (!f.optional) problems.push(`${f.name}: ${detail}`);
    }
  }

  console.log("\nValues are never printed. .env.local is read for local status only;");
  console.log("production values live in Vercel and are not visible here.");

  if (problems.length) {
    console.log(`\n${problems.length} required feature(s) are not configured locally:`);
    for (const p of problems) console.log("  - " + p);
    process.exit(1);
  }
  console.log("\nAll required features are configured.");
}
