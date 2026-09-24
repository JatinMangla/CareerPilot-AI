import { createRequire } from "node:module";
import { join } from "node:path";

/** Loads a lib/ module compiled by scripts/test.mjs. */
export function lib(name) {
  const build = process.env.CP_TEST_BUILD;
  if (!build) throw new Error("Run the tests through `node scripts/test.mjs`.");
  return createRequire(import.meta.url)(join(build, `${name}.js`));
}
