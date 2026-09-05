#!/usr/bin/env node
/**
 * Generates .claude/repo-map.md — the one file to read before touching anything.
 *
 * Orienting in this repo by hand means globbing, hitting agent/node_modules, and
 * reading a dozen files. That is tens of thousands of tokens spent re-deriving
 * facts that do not change between sessions. This writes them down once.
 *
 *   node scripts/repo-map.mjs            regenerate the map
 *   node scripts/repo-map.mjs --stdout   print instead of writing
 *   node scripts/repo-map.mjs --stale    exit 1 if the map is older than the code
 */

import { writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { ROOT, sourceFiles, moduleGraph, routes, aiTasks, read, isMain } from "./lib/scan.mjs";
import { treeLines } from "./tree.mjs";

const OUT = ".claude/repo-map.md";

/** Which external service each API route talks to — read from its imports. */
function serviceOf(file, imports) {
  const src = read(file);
  const hits = new Set();
  if (imports.includes("lib/gemini.ts") || src.includes("gemini")) hits.add("Gemini");
  if (imports.includes("lib/kv.ts")) hits.add("Upstash Redis");
  if (src.includes("nodemailer")) hits.add("Gmail SMTP");
  if (src.includes("imapflow")) hits.add("Gmail IMAP");
  if (src.includes("resend") || src.includes("RESEND")) hits.add("Resend");
  if (src.includes("greenhouse") || src.includes("lever") || src.includes("ashby")) hits.add("ATS boards");
  if (src.includes("adzuna") || src.includes("ADZUNA")) hits.add("Adzuna");
  if (src.includes("openwebninja") || src.includes("OPENWEBNINJA")) hits.add("OpenWeb Ninja");
  if (src.includes("api.github.com")) hits.add("GitHub API");
  if (src.includes("pdf-parse") || src.includes("mammoth")) hits.add("file parsing");
  return [...hits].join(", ") || "—";
}

/**
 * Paths middleware.ts lets through unauthenticated.
 *
 * Read from the actual predicates — `pathname.startsWith("/x")` and
 * `pathname === "/x"` — rather than from every quoted string in the file, which
 * would also pick up import specifiers and the matcher regex.
 */
function publicRoutes() {
  if (!existsSync(join(ROOT, "middleware.ts"))) return null;
  const src = read("middleware.ts");

  /*
   * Only the allow-list ABOVE the session check counts. Below it there is a
   * second `pathname.startsWith("/api/")` that decides between a 401 and a
   * redirect — scanning the whole file picks that up and marks every API route
   * public, which is exactly backwards.
   */
  const end = src.indexOf("const token");
  if (end === -1) return null; // shape changed — say "?" rather than guess
  const head = src.slice(0, end);

  const rules = [];
  for (const m of head.matchAll(/pathname\.startsWith\(\s*["']([^"']+)["']\s*\)/g)) {
    rules.push({ prefix: m[1] });
  }
  for (const m of head.matchAll(/pathname\s*===\s*["']([^"']+)["']/g)) {
    rules.push({ exact: m[1] });
  }
  return rules;
}

const isPublic = (url, rules) =>
  rules === null ? "?" : rules.some((r) => (r.exact ? url === r.exact : url.startsWith(r.prefix)));

function build() {
  const { modules, importedBy } = moduleGraph();
  const allRoutes = routes();
  const tasks = aiTasks();
  const open = publicRoutes();
  const files = sourceFiles();

  const out = [];
  const push = (...lines) => out.push(...lines);

  push("# Repo map — CareerPilot AI");
  push("");
  push("<!-- GENERATED FILE. Do not edit by hand: node scripts/repo-map.mjs -->");
  push("");
  push(
    `_${files.length} source files · ${allRoutes.filter((r) => r.kind === "page").length} pages · ` +
      `${allRoutes.filter((r) => r.kind === "api").length} API routes · ${tasks.length} AI tasks · ` +
      `generated ${new Date().toISOString().slice(0, 10)}_`
  );
  push("");
  push("**Read this before exploring.** It is regenerated from the source, so it does not drift.");
  push("For import relationships see [docs/dep-graph.md](../docs/dep-graph.md).");
  push("");

  push("## What this is");
  push("");
  push("Single-user AI career copilot. Next.js 14 App Router + TypeScript + Tailwind, deployed on");
  push("Vercel. API routes are the entire backend. Google Gemini (free tier) is the sole AI");
  push("provider. User state lives in browser localStorage, mirrored to Upstash Redis for");
  push("cross-device sync.");
  push("");

  push("## Tree");
  push("");
  push("```");
  push(...treeLines());
  push("```");
  push("");

  push("## Pages");
  push("");
  push("| URL | File | Lines |");
  push("| --- | --- | --- |");
  for (const r of allRoutes.filter((x) => x.kind === "page")) {
    push(`| \`${r.url}\` | [${r.file}](../${r.file}) | ${modules.get(r.file)?.loc ?? "—"} |`);
  }
  push("");

  push("## API routes");
  push("");
  push("| URL | File | Auth | Talks to |");
  push("| --- | --- | --- | --- |");
  for (const r of allRoutes.filter((x) => x.kind === "api")) {
    const isOpen = isPublic(r.url, open);
    push(
      `| \`${r.url}\` | [${r.file}](../${r.file}) | ${isOpen === "?" ? "?" : isOpen ? "public" : "cookie"} | ` +
        `${serviceOf(r.file, modules.get(r.file)?.imports ?? [])} |`
    );
  }
  push("");
  push("Write endpoints use **POST, never PUT** — this Vercel deployment returns 405 on PUT");
  push("before the handler runs.");
  push("");

  push("## AI tasks");
  push("");
  push("All of them run through [app/api/ai/route.ts](../app/api/ai/route.ts), which looks the task");
  push("up in [lib/prompts.ts](../lib/prompts.ts). `tier` picks the Gemini model chain in");
  push("[lib/gemini.ts](../lib/gemini.ts): `fast` = classification, `standard` = most work,");
  push("`deep` = text that reaches an employer.");
  push("");
  push("| Task | Mode | Tier | Max out | Cache | Called from |");
  push("| --- | --- | --- | --- | --- | --- |");
  for (const t of tasks) {
    push(
      `| \`${t.name}\` | ${t.mode} | ${t.tier} | ${t.maxTokens ?? "default"} | ` +
        `${t.cacheTtl ? t.cacheTtl + "s" : "—"} | ${t.calledFrom.map((f) => `\`${f}\``).join(", ") || "—"} |`
    );
  }
  push("");
  push("Adding a task means touching four things: the registry entry in `lib/prompts.ts`, its");
  push("`schema` (Gemini rejects `additionalProperties` — see `toGeminiSchema`), its `tier`, and");
  push("the `jsonTask`/`streamTask` call in the page. Run `node scripts/ai-cost.mjs` after.");
  push("");

  push("## Modules");
  push("");
  push("| File | Lines | Exports | Imported by |");
  push("| --- | --- | --- | --- |");
  const libFirst = [...modules.keys()]
    .filter((f) => !f.startsWith("scripts/") && !f.startsWith("agent/") && !/\/(page|route)\.tsx?$/.test(f))
    .sort();
  for (const f of libFirst) {
    const m = modules.get(f);
    const users = importedBy.get(f) ?? [];
    const exp = m.exports.slice(0, 8).join(", ") + (m.exports.length > 8 ? `, +${m.exports.length - 8}` : "");
    push(`| [${f}](../${f}) | ${m.loc} | ${exp || "—"} | ${users.length} |`);
  }
  push("");

  push("## Commands");
  push("");
  push("```bash");
  push("node scripts/check.mjs            # typecheck + token budget + build");
  push("node scripts/check.mjs --fast     # skip the build");
  push("node scripts/doctor.mjs           # which features are configured, and what breaks");
  push("node scripts/ai-cost.mjs          # per-task token cost table");
  push("node scripts/dep-graph.mjs --who lib/store.ts   # what imports one file");
  push("node scripts/repo-map.mjs         # regenerate this file");
  push("node node_modules/next/dist/bin/next dev        # run the app");
  push("```");
  push("");
  push("`npm` works from PowerShell but **fails from bash** on this machine (nvm symlink into");
  push("another Windows account → `EPERM lstat 'C:\\Users\\Administrator'`). `next lint` has no");
  push("config and drops into an interactive prompt — do not run it.");
  push("");

  return out.join("\n") + "\n";
}

/** The map is stale when any source file is newer than it. */
function staleness() {
  const mapPath = join(ROOT, OUT);
  if (!existsSync(mapPath)) return { stale: true, newest: null };
  const mapTime = statSync(mapPath).mtimeMs;
  let newest = null;
  for (const f of sourceFiles()) {
    if (f.startsWith("scripts/")) continue;
    const t = statSync(join(ROOT, f)).mtimeMs;
    if (t > mapTime && (!newest || t > newest.t)) newest = { f, t };
  }
  return { stale: Boolean(newest), newest: newest?.f ?? null };
}

if (isMain(import.meta.url)) {
  if (process.argv.includes("--stale")) {
    const { stale, newest } = staleness();
    if (stale) {
      console.error(`${OUT} is out of date (${newest ?? "missing"} is newer). Run: node scripts/repo-map.mjs`);
      process.exit(1);
    }
    console.log(`${OUT} is current.`);
    process.exit(0);
  }

  const text = build();
  if (process.argv.includes("--stdout")) {
    console.log(text);
  } else {
    writeFileSync(join(ROOT, OUT), text, "utf8");
    const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
    console.log(`${OUT} · ${kb} KB · ~${Math.ceil(text.length / 4)} tokens to read`);
  }
}

export { build, staleness };
