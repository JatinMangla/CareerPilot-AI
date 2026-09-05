---
description: Regenerate the repo map and dependency graph from source
allowed-tools: Bash(node scripts/repo-map.mjs), Bash(node scripts/dep-graph.mjs), Bash(git diff:*), Read
---

Run both generators:

```
node scripts/repo-map.mjs
node scripts/dep-graph.mjs
```

Then `git diff --stat .claude/repo-map.md docs/dep-graph.md`. If the structure changed
(a new route, a new AI task, a new import hub, a new cycle), say what changed in one or two
lines. If only the date line moved, say so and stop.
