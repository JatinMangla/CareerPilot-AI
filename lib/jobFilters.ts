/**
 * Cross-cutting rules for job listings — used by the /api/jobs route on the
 * server and by every page that shows a job list on the client.
 *
 * Three separate problems live here because they are all "is this the same /
 * a wanted listing?" questions:
 *
 *  1. Blocked sites. Aggregators republish other people's postings behind a
 *     paywall or a sign-up wall. BeBee is the worst offender in the Indian
 *     results — it asks for money before you can apply — so nothing from these
 *     hosts is ever shown, whatever the source API returns.
 *
 *  2. Duplicates. The same role reaches us from a company board AND from
 *     JSearch AND from Adzuna, each with a different id, so id-based dedupe
 *     lets three copies of one job through. `fingerprint` is id-independent.
 *
 *  3. Dismissals. "I removed this and it came back" is the same problem: the
 *     id changes on the next search, so an id-keyed dismissal list stops
 *     matching. Dismissals are stored by fingerprint for that reason.
 */

/**
 * Hosts we never show a listing from.
 *
 * These are republishers, not employers: the listing is scraped from somewhere
 * else, and applying means paying, registering, or being redirected into an ad
 * funnel. A real posting from the same company still reaches you through its
 * own careers board or through a first-party aggregator result.
 */
export const BLOCKED_JOB_HOSTS = [
  "bebee.com",
  "bebee.co",
  "jobrapido.com",
  "neuvoo.",
  "talent.com",
  "jooble.org",
  "trabajo.org",
  "whatjobs.com",
  "jobsora.com",
  "learn4good.com",
  "clickjobs.io",
  "jobleads.com",
  "expertini.com",
  "grabjobs.co",
  "joblum.com",
  "smartrecruiters.com/o/", // scraped mirror pages, not the ATS form itself
  "recruit.net",
  "careerjet.",
  "jobisjob.",
  "adzuna.in/land", // Adzuna's own redirect wall, not the employer
];

/** Is this listing from a site that charges or walls the application? */
export function isBlockedListing(url: string | undefined, company?: string): boolean {
  const u = (url || "").toLowerCase();
  if (!u) return false;
  if (BLOCKED_JOB_HOSTS.some((h) => u.includes(h))) return true;
  // Some feeds put the republisher in the employer field instead of the URL.
  const c = (company || "").toLowerCase().trim();
  return c === "bebee" || c === "bebee india" || c === "jobrapido" || c === "talent.com";
}

/* ---------------- Location ---------------- */

export const INDIA_RE =
  /india|bengaluru|bangalore|delhi|gurgaon|gurugram|noida|hyderabad|pune|mumbai|chennai|kolkata|ahmedabad|jaipur|indore|coimbatore/i;

/**
 * Regions that a "remote" role is restricted to. A posting advertised as
 * "Remote - USA" or "Canada - Remote" is not open to a candidate in India, so
 * a bare "remote" match is not good enough.
 */
const OTHER_REGION_RE =
  /\b(us|usa|united states|nyc|new york|san francisco|seattle|austin|boston|chicago|denver|toronto|vancouver|canada|ireland|dublin|estonia|portugal|lisbon|poland|romania|spain|barcelona|madrid|france|paris|germany|berlin|munich|netherlands|amsterdam|uk|london|united kingdom|europe|emea|australia|sydney|melbourne|singapore|japan|tokyo|korea|china|brazil|mexico|argentina|colombia|israel|amer|latam|apac|nordics|sweden|stockholm|denmark|copenhagen|norway|switzerland|zurich|dubai|uae)\b/i;

const REMOTE_RE = /remote|anywhere|global|worldwide|distributed|work from home|wfh/i;

/**
 * "Anywhere, NY" — how JSearch reports a US-only remote role. The state code is
 * the only thing marking it as American, and `\bus\b` never fires on it.
 *
 * Two-letter codes are ambiguous in general, so this only matches the exact
 * "<somewhere>, XX" tail. IN is deliberately absent: it is Indiana, but it is
 * also India's country code, and dropping those would be the worse error.
 */
const US_STATE_TAIL_RE =
  /,\s*(a[klrz]|c[aot]|de|fl|ga|hi|i[ad]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])\s*$/i;

/**
 * Is a listing in `location` reachable by someone searching for `wanted`?
 *
 * The aggregators do not reliably honour a location filter — a search for
 * "react developer jobs in India" came back full of Los Angeles postings — so
 * this is applied to their results on our side rather than trusted to them.
 */
export function matchesLocation(location: string | undefined, wanted: string): boolean {
  const want = (wanted || "").toLowerCase().trim();
  if (!want || want === "remote" || want === "anywhere") return true;

  // Periods stripped: "Remote - U.S." otherwise slips past OTHER_REGION_RE,
  // because \b needs a word character next to that final "." and finds none.
  const l = (location || "").toLowerCase().replace(/\./g, "");
  if (!l.trim()) return false;

  if (want.includes("india")) {
    if (INDIA_RE.test(l)) return true;
    if (US_STATE_TAIL_RE.test((location || "").trim())) return false;
    return REMOTE_RE.test(l) && !OTHER_REGION_RE.test(l);
  }
  return l.includes(want) || REMOTE_RE.test(l);
}

/** ISO country code for the aggregators that want one. */
export function countryCode(wanted: string): string {
  return /india/i.test(wanted || "") ? "in" : "";
}

function normalize(s: string | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Identity of a job independent of which API produced it.
 *
 * Title and company only: the same posting is routinely listed as "Bengaluru,
 * India" on one feed and "Bangalore" or "Remote - India" on another, so
 * including location would split one job into three.
 */
export function fingerprint(job: {
  title?: string;
  company?: string;
}): string {
  const title = normalize(job.title)
    // Seniority and req-number noise differs between feeds for the same role.
    .replace(/\b(sr|snr|senior|jr|junior|i{1,3}|iv|[0-9]{3,})\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${normalize(job.company)}::${title}`;
}

/**
 * How good a listing's origin is, for choosing which copy of a job to keep.
 *
 * A company board gives the employer's own application form; an aggregator
 * gives a redirect that may be stale or wrapped in a signup; an AI lead may not
 * exist at all. Higher wins.
 */
export function sourceRank(source: string | undefined): number {
  if (source === "company-boards" || source === "yc-boards") return 3;
  if (source === "jsearch" || source === "adzuna") return 2;
  return 1;
}

/**
 * Keeps the first occurrence of each fingerprint.
 *
 * Callers order their input by source quality first — a company-board listing
 * ahead of the same role from an aggregator — so the copy that survives is the
 * one that applies directly on the employer's ATS.
 */
export function dedupeJobs<T extends { title?: string; company?: string; url?: string }>(
  jobs: T[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const job of jobs) {
    const fp = fingerprint(job);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(job);
  }
  return out;
}
