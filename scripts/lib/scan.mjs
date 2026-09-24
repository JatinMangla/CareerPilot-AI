/**
 * Shared repo scanner — walks the project once and answers structural questions.
 *
 * Every script in scripts/ imports this, so the tree, the dependency graph and
 * the repo map always agree with each other and with the filesystem.
 *
 * Zero dependencies on purpose: `npm install` cannot run on this machine (Node is
 * an nvm symlink into another Windows account, so npm dies with EPERM). Nothing
 * here may require a package that is not already vendored.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Directories that must never be walked. `node_modules` is matched by NAME, not
 * by path, because this repo has a second one at agent/node_modules — a plain
 * `find app agent lib` here returns 200 lines of Playwright internals before it
 * reaches a single project file.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".vercel",
  "out",
  "dist",
  "coverage",
  ".turbo",
]);

const SKIP_FILES = new Set(["next-env.d.ts", "package-lock.json"]);

const isSkippedFile = (name) =>
  SKIP_FILES.has(name) ||
  name.endsWith(".tsbuildinfo") ||
  name.startsWith(".env") ||
  name === ".DS_Store";

/** Forward slashes everywhere, so output is identical on Windows and on CI. */
export const posix = (p) => p.split(sep).join("/");

function walkFs(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFs(join(dir, entry.name), acc);
    } else if (!isSkippedFile(entry.name)) {
      acc.push(posix(relative(ROOT, join(dir, entry.name))));
    }
  }
  return acc;
}

/**
 * Files git would commit: tracked, plus untracked-but-not-ignored.
 *
 * Walking the disk alone listed gitignored personal data — agent/screenshots/
 * named every company applied to — in the committed repo map. Honouring
 * .gitignore is the only rule that stays right as new ignores are added.
 * Returns null outside a git checkout, and the walk then stands on its own.
 */
function gitVisible() {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return new Set(out.split("\0").filter(Boolean));
  } catch {
    return null;
  }
}

/** Every file git would commit, repo-relative, sorted. */
export function walk(dir = ROOT) {
  const all = walkFs(dir, []);
  const visible = gitVisible();
  return (visible ? all.filter((f) => visible.has(f)) : all).sort();
}

const SOURCE_RE = /\.(ts|tsx|mjs|js|jsx)$/;
export const sourceFiles = () => walk().filter((f) => SOURCE_RE.test(f));

export const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ *
 * Module parsing
 * ------------------------------------------------------------------ */

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const BARE_IMPORT_RE = /^\s*import\s+["']([^"']+)["']/gm;

/** Candidate on-disk paths for an import specifier, in resolution order. */
const candidates = (base) => [
  base,
  base + ".ts",
  base + ".tsx",
  base + ".mjs",
  base + ".js",
  base + "/index.ts",
  base + "/index.tsx",
];

/** Resolve an import specifier to a repo-relative file, or null if external. */
export function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) {
    base = spec.slice(2); // tsconfig paths maps "@/*" to "./*"
  } else if (spec.startsWith(".")) {
    base = posix(relative(ROOT, resolve(ROOT, dirname(fromFile), spec)));
  } else {
    return null; // node_modules package or node: builtin
  }

  for (const cand of candidates(base)) {
    const abs = join(ROOT, cand);
    if (existsSync(abs) && statSync(abs).isFile()) return cand;
  }
  return null;
}

const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:default\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]+)\}/gm;

/** Internal imports and top-level export names for one source file. */
export function parseModule(rel) {
  const src = read(rel);

  const imports = new Set();
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const target = resolveImport(m[1], rel);
      if (target && target !== rel) imports.add(target);
    }
  }

  const exports = new Set();
  EXPORT_RE.lastIndex = 0;
  let m;
  while ((m = EXPORT_RE.exec(src))) exports.add(m[1]);

  EXPORT_LIST_RE.lastIndex = 0;
  while ((m = EXPORT_LIST_RE.exec(src))) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) exports.add(name);
    }
  }

  return {
    file: rel,
    imports: [...imports].sort(),
    exports: [...exports].sort(),
    loc: src.split("\n").length,
  };
}

/** file -> {imports, exports, loc}, plus a reverse index of who imports what. */
export function moduleGraph() {
  const modules = new Map();
  for (const f of sourceFiles()) modules.set(f, parseModule(f));

  const importedBy = new Map([...modules.keys()].map((f) => [f, []]));
  for (const [file, mod] of modules) {
    for (const dep of mod.imports) {
      if (importedBy.has(dep)) importedBy.get(dep).push(file);
    }
  }
  for (const list of importedBy.values()) list.sort();

  return { modules, importedBy };
}

/** Import cycles, as arrays of files. Depth-first, each cycle reported once. */
export function findCycles(modules) {
  const seen = new Set();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  const visit = (file) => {
    if (onStack.has(file)) {
      const cycle = stack.slice(stack.indexOf(file));
      const key = [...cycle].sort().join(">");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push([...cycle, file]);
      }
      return;
    }
    if (stack.includes(file)) return;
    stack.push(file);
    onStack.add(file);
    for (const dep of modules.get(file)?.imports ?? []) visit(dep);
    stack.pop();
    onStack.delete(file);
  };

  for (const file of modules.keys()) visit(file);
  return cycles;
}

/* ------------------------------------------------------------------ *
 * Next.js App Router
 * ------------------------------------------------------------------ */

/** Every page and API route, with the URL it serves. */
export function routes() {
  return sourceFiles()
    .filter((f) => /^app\/(?:.*\/)?(page|route)\.tsx?$/.test(f))
    .map((file) => {
      const kind = /\/route\.tsx?$/.test(file) || /^app\/route\.tsx?$/.test(file) ? "api" : "page";
      const url =
        "/" +
        file
          .replace(/^app\//, "")
          .replace(/(^|\/)(page|route)\.tsx?$/, "")
          .replace(/\/$/, "");
      return { file, kind, url: url === "/" ? "/" : url };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));
}

/* ------------------------------------------------------------------ *
 * AI task registry (lib/prompts.ts)
 * ------------------------------------------------------------------ */

const PROMPTS = "lib/prompts.ts";

/**
 * Parse the `tasks` registry without a TypeScript parser.
 *
 * The registry has a stable shape: task keys sit at exactly two spaces of indent
 * inside `export const tasks`, their fields at four. If that ever changes this
 * returns fewer tasks than exist, so callers assert the count rather than
 * trusting it silently.
 */
export function aiTasks() {
  if (!existsSync(join(ROOT, PROMPTS))) return [];
  const src = read(PROMPTS);
  const start = src.indexOf("export const tasks");
  if (start === -1) return [];

  const tasks = [];
  let current = null;
  const push = () => {
    if (current) tasks.push(current);
    current = null;
  };

  for (const line of src.slice(start).split("\n")) {
    const open = /^ {2}([a-z_][A-Za-z0-9_]*):\s*\{/.exec(line);
    if (open) {
      push();
      current = {
        name: open[1],
        mode: "?",
        tier: "standard",
        maxTokens: null,
        schema: false,
        cacheTtl: null,
      };
      continue;
    }
    if (/^\};/.test(line)) {
      push();
      break;
    }
    if (!current) continue;

    let m;
    if ((m = /^ {4}mode:\s*"(\w+)"/.exec(line))) current.mode = m[1];
    if ((m = /^ {4}tier:\s*"(\w+)"/.exec(line))) current.tier = m[1];
    if ((m = /^ {4}maxTokens:\s*(\d+)/.exec(line))) current.maxTokens = Number(m[1]);
    if ((m = /^ {4}cacheTtl:\s*(\d+)/.exec(line))) current.cacheTtl = Number(m[1]);
    if (/^ {4}schema:/.test(line)) current.schema = true;
  }

  // Which files ask for each task, so the map answers "where is this used".
  // scripts/ is excluded: the tooling names tasks in allow-lists and fixtures,
  // which would otherwise show up as if it called them.
  const callers = new Map(tasks.map((t) => [t.name, []]));
  for (const f of sourceFiles()) {
    if (f === PROMPTS || f.startsWith("scripts/")) continue;
    const other = read(f);
    for (const t of tasks) {
      if (other.includes('"' + t.name + '"')) callers.get(t.name).push(f);
    }
  }
  for (const t of tasks) t.calledFrom = callers.get(t.name);

  return tasks;
}

/** Fallback budgets app/api/ai/route.ts applies when a task omits maxTokens. */
export const TASK_DEFAULTS = { stream: 32000, json: 8000 };

/* ------------------------------------------------------------------ *
 * Script helpers
 * ------------------------------------------------------------------ */

/**
 * True when this module is the entry point. A naive string compare fails here:
 * import.meta.url is percent-encoded ("AI%20resume") while process.argv[1] is a
 * plain Windows path.
 */
export const isMain = (importMetaUrl) =>
  importMetaUrl === pathToFileURL(process.argv[1]).href;
