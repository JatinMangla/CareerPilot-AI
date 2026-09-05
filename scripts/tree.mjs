#!/usr/bin/env node
/**
 * Annotated project tree.
 *
 * Exists because `find`, `ls -R` and `dir /s` all walk agent/node_modules and
 * bury the 51 real source files under Playwright internals. This walks only what
 * matters and labels each directory with its role.
 *
 *   node scripts/tree.mjs            print the tree
 *   node scripts/tree.mjs --md       print it as a fenced markdown block
 */



import { sourceFiles, walk, read, isMain } from "./lib/scan.mjs";

/** What each directory is for. Keep in sync with CLAUDE.md. */
const ROLES = {
  app: "Next.js App Router — pages and API routes",
  "app/api": "server endpoints (deploy as Vercel serverless functions)",
  components: "shared client components",
  lib: "domain logic, AI provider, storage, auth",
  "lib/pdf": "react-pdf resume templates",
  agent: "local Playwright auto-apply runner (separate install)",
  scripts: "repo tooling — run with plain node, no npm",
  "scripts/lib": "shared scanner used by every script",
  docs: "generated documentation",
  ".claude": "Claude Code project configuration",
};

const BRANCH = "|-- ";
const LAST = "`-- ";
const PIPE = "|   ";
const GAP = "    ";

/** Group a flat file list into a nested {dirs, files} tree. */
function build(files) {
  const root = { dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.split("/");
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
      node = node.dirs.get(dir);
    }
    node.files.push(parts[parts.length - 1]);
  }
  return root;
}

function render(node, prefix, path, out, locOf) {
  const dirs = [...node.dirs.keys()].sort();
  const entries = [
    ...dirs.map((d) => ({ name: d, dir: true })),
    ...node.files.sort().map((f) => ({ name: f, dir: false })),
  ];

  entries.forEach((entry, i) => {
    const last = i === entries.length - 1;
    const full = path ? path + "/" + entry.name : entry.name;

    if (entry.dir) {
      const role = ROLES[full];
      out.push(prefix + (last ? LAST : BRANCH) + entry.name + "/" + (role ? "   # " + role : ""));
      render(node.dirs.get(entry.name), prefix + (last ? GAP : PIPE), full, out, locOf);
    } else {
      const n = locOf(full);
      out.push(prefix + (last ? LAST : BRANCH) + entry.name + (n ? "  (" + n + ")" : ""));
    }
  });
}

/** The annotated tree as an array of lines. */
export function treeLines() {
  const files = walk();
  const source = new Set(sourceFiles());
  const locCache = new Map();
  const locOf = (f) => {
    if (!source.has(f)) return 0;
    if (!locCache.has(f)) locCache.set(f, read(f).split("\n").length);
    return locCache.get(f);
  };

  const out = ["."];
  render(build(files), "", "", out, locOf);
  return out;
}

if (isMain(import.meta.url)) {
  const lines = treeLines();
  const md = process.argv.includes("--md");
  if (md) console.log("```");
  console.log(lines.join("\n"));
  if (md) console.log("```");
  console.error(`\n${lines.length - 1} entries · numbers in parentheses are lines of code`);
}
