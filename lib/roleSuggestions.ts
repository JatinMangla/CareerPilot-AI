import type { Profile } from "./types";

/**
 * Role / keyword suggestions built from the user's own profile.
 *
 * The search box was a bare text input with one hardcoded default, so the
 * quality of every search depended on remembering the right phrasing. Job
 * feeds are literal — "React Developer" and "Frontend Engineer" return
 * substantially different result sets for the same person — so the phrasings
 * that match this profile are worth offering explicitly.
 *
 * Derived locally, not by an AI call: it has to be instant as the field opens,
 * and everything it needs is already in the profile.
 */

/** Title shapes that dominate Indian frontend postings. */
const TITLE_FORMS = ["Developer", "Engineer"];

/** Skills that read naturally as a title prefix ("React Developer"). */
const TITLE_SKILLS = [
  "react",
  "javascript",
  "typescript",
  "angular",
  "vue",
  "next.js",
  "node.js",
  "tailwind",
  "redux",
];

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function roleSuggestions(profile: Partial<Profile> | null | undefined): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim().replace(/\s+/g, " ");
    if (v.length > 2 && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };

  // 1. Exactly what the user said they want, split on commas / slashes.
  for (const r of (profile?.desiredRoles || "").split(/[,/|]/)) push(r);

  // 2. Their current title.
  if (profile?.role) push(profile.role);

  // 3. Their strongest skills as titles — this is what actually widens a search.
  const skills = (profile?.skills || [])
    .map((s) => s.toLowerCase().replace(/\s*\(.*\)\s*/, "").trim())
    .filter((s) => TITLE_SKILLS.includes(s));
  for (const skill of skills.slice(0, 4)) {
    for (const form of TITLE_FORMS) push(`${titleCase(skill)} ${form}`);
  }

  // 4. The generic frontend phrasings every board uses, so nothing obvious is
  //    missed when the profile is sparse.
  for (const g of [
    "Frontend Developer",
    "Frontend Engineer",
    "React Developer",
    "UI Engineer",
    "Web Developer",
    "Full Stack Developer",
    "Software Engineer",
  ])
    push(g);

  return out.slice(0, 14);
}

/**
 * The handful of phrasings to actually send to the aggregator APIs alongside
 * the typed query. Each one is a metered API call, so this stays short.
 */
export function searchVariants(
  query: string,
  profile: Partial<Profile> | null | undefined
): string[] {
  const suggestions = roleSuggestions(profile);
  const typed = query.trim().toLowerCase();
  return suggestions.filter((s) => s.toLowerCase() !== typed).slice(0, 3);
}
