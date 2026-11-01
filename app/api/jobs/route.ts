import { searchCompanyBoards } from "@/lib/companyBoards";
import {
  countryCode,
  dedupeJobs,
  isBlockedListing,
  matchesLocation,
} from "@/lib/jobFilters";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Live job listings.
 *
 * This used to return the FIRST source that answered and stop — company boards,
 * else JSearch, else Adzuna — capped at 10-25 results. That is why a search
 * only ever produced a handful of jobs: one page of one API. It now runs every
 * source the requested focus allows, in parallel, pages the aggregators, and
 * merges the lot:
 *
 *   focus "boards"  — company ATS boards only (Greenhouse/Lever/Ashby)
 *   focus "yc"      — the Y Combinator-backed subset of those boards
 *   focus "portals" — aggregators only (Google for Jobs via JSearch, Adzuna)
 *   focus "all"     — everything, boards first
 *
 * Board listings are ordered ahead of aggregator listings before dedupe, so
 * when the same role arrives from both, the copy that survives is the one that
 * applies directly on the employer's own ATS.
 *
 * Returns { available: false } only if nothing at all came back. The client says
 * so and offers AI-researched leads as an explicit choice.
 *
 * `warnings` names any source that failed or is not set up. A dead API key used to
 * look exactly like a quiet day: fewer results, and nothing to say why.
 */

interface Listing {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  url: string;
  description: string;
  source: string;
  postedAt?: string;
}

/** Hard ceiling on what one search may return, whatever the client asks for. */
const MAX_LIMIT = 150;

/** Aggregator pages to walk. Each is one API call against a metered quota. */
const AGGREGATOR_PAGES = 3;

/**
 * One aggregator request may not hold the search up longer than this. It was 15s,
 * and JSearch takes about that for its three pages, so with several phrasings in
 * parallel most of them timed out and their jobs vanished without a word. Still
 * inside the 60s function limit, and on a par with the boards' own deadline.
 */
const AGGREGATOR_TIMEOUT_MS = 28_000;

/**
 * Board fetching stops starting new requests this long into the search, leaving
 * room for the shortlist's descriptions inside the 60s function limit. 121
 * boards at 20 at a time and 9s each could otherwise run to 63s and return
 * nothing at all.
 */
const BOARD_DEADLINE_MS = 32_000;

/**
 * Drops what should never reach the user: paywalled republishers, and jobs in
 * the wrong country.
 *
 * The location check is not belt-and-braces. Asking JSearch for "react
 * developer jobs in India" came back full of Los Angeles postings — the phrase
 * in the query is a hint, not a filter — so the results are filtered here
 * against the same rule the company boards use.
 */
function clean(
  listings: Listing[],
  wantedLocation: string,
  /**
   * Aggregators report a remote US role as "Anywhere, NY" — the location field
   * alone says nothing, and the restriction is stated in the title instead
   * ("Senior Engineer - Remote US Only"). Match against both for those sources.
   * Company boards have reliable location fields and are matched on location
   * alone, so a role legitimately titled "… (US)" isn't second-guessed.
   */
  useTitle = false
): Listing[] {
  return listings.filter(
    (l) =>
      l.title &&
      l.url &&
      !isBlockedListing(l.url, l.company) &&
      // Title first, so the location stays at the end of the string — the
      // "Anywhere, NY" check in matchesLocation is anchored to that tail.
      matchesLocation(useTitle ? `${l.title} ${l.location}` : l.location, wantedLocation)
  );
}

/**
 * Counts one source's requests, and says why if any failed. One phrasing of four
 * timing out is not the same news as the key having expired, so the wording
 * follows how much was lost. `status` 0 means no answer at all.
 */
function failureLog(name: string, total: number, warn: (m: string) => void) {
  let failed = 0;
  let last = 0;
  return {
    fail(status: number) {
      failed++;
      last = status;
    },
    report() {
      if (!failed) return;
      if (last === 401 || last === 403) {
        warn(`${name} refused the API key, so its jobs are missing. Check the key in your Vercel settings.`);
      } else if (last === 429) {
        warn(`${name} is out of free searches for now, so its jobs are missing or partial.`);
      } else {
        warn(
          failed >= total
            ? `${name} didn't answer, so its jobs are missing from this search.`
            : `${name} answered ${total - failed} of ${total} searches, so its results are partial.`
        );
      }
    },
  };
}

async function fromJSearch(queries: string[], loc: string, warn: (m: string) => void): Promise<Listing[]> {
  const key = process.env.OPENWEBNINJA_API_KEY;
  if (!key) {
    warn("Google for Jobs isn't set up (no OPENWEBNINJA_API_KEY), so this search skipped it.");
    return [];
  }
  const out: Listing[] = [];
  const failures = failureLog("Google for Jobs", queries.length, warn);

  // One request per query variant, each asking for several pages of results.
  // "react developer" and "frontend engineer" return substantially different
  // sets on Google for Jobs, so variants are worth more than extra pages.
  await Promise.all(
    queries.map(async (q) => {
      try {
        const cc = countryCode(loc);
        const url =
          `https://api.openwebninja.com/jsearch/search-v2` +
          `?query=${encodeURIComponent(`${q} jobs in ${loc}`)}` +
          `&page=1&num_pages=${AGGREGATOR_PAGES}&date_posted=month` +
          (cc ? `&country=${cc}` : "");
        const res = await fetch(url, {
          headers: { "X-API-Key": key },
          cache: "no-store",
          signal: AbortSignal.timeout(AGGREGATOR_TIMEOUT_MS),
        });
        if (!res.ok) return failures.fail(res.status);
        const data = await res.json();
        for (const j of (data?.data?.jobs || data?.data || []) as any[]) {
          // job_country is the only field this API fills in reliably for a
          // remote posting — job_location says "Anywhere, NY" and job_city is
          // empty, so this is what actually keeps US roles out of an India search.
          if (cc && j.job_country && String(j.job_country).toLowerCase() !== cc) continue;
          out.push({
            id: String(j.job_id || `${j.employer_name}-${j.job_title}`).slice(0, 80),
            title: j.job_title || "",
            company: j.employer_name || "Unknown",
            location:
              j.job_location ||
              [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "),
            salary:
              j.job_salary_string ||
              (j.job_min_salary && j.job_max_salary
                ? `${j.job_min_salary}-${j.job_max_salary} ${j.job_salary_period || ""}`.trim()
                : ""),
            url: j.job_apply_link || j.job_google_link || "",
            description: String(j.job_description || "").slice(0, 1200),
            source: "jsearch",
            postedAt: j.job_posted_at_datetime_utc || undefined,
          });
        }
      } catch {
        // One variant failing must not lose the others.
        failures.fail(0);
      }
    })
  );
  failures.report();
  return out;
}

async function fromAdzuna(queries: string[], loc: string, warn: (m: string) => void): Promise<Listing[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    warn("Adzuna isn't set up (no ADZUNA_APP_ID / ADZUNA_APP_KEY), so this search skipped it.");
    return [];
  }
  const out: Listing[] = [];
  const failures = failureLog("Adzuna", queries.length * AGGREGATOR_PAGES, warn);

  const pages = Array.from({ length: AGGREGATOR_PAGES }, (_, i) => i + 1);
  await Promise.all(
    queries.flatMap((q) =>
      pages.map(async (page) => {
        try {
          const params = new URLSearchParams({
            app_id: appId,
            app_key: appKey,
            results_per_page: "50",
            what: q,
            max_days_old: "30",
          });
          if (loc && loc.toLowerCase() !== "india") params.set("where", loc);
          const res = await fetch(
            `https://api.adzuna.com/v1/api/jobs/in/search/${page}?${params.toString()}`,
            { cache: "no-store", signal: AbortSignal.timeout(AGGREGATOR_TIMEOUT_MS) }
          );
          if (!res.ok) return failures.fail(res.status);
          const data = await res.json();
          for (const r of (data.results || []) as any[]) {
            out.push({
              id: String(r.id),
              title: r.title || "",
              company: r.company?.display_name || "Unknown",
              location: r.location?.display_name || "",
              salary:
                r.salary_min || r.salary_max
                  ? `₹${Math.round((r.salary_min || 0) / 100000)}-${Math.round(
                      (r.salary_max || 0) / 100000
                    )} LPA (listed)`
                  : "",
              url: r.redirect_url,
              description: String(r.description || "").slice(0, 1200),
              source: "adzuna",
              postedAt: r.created || undefined,
            });
          }
        } catch {
          failures.fail(0);
        }
      })
    )
  );
  failures.report();
  return out;
}

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}) as any);
  const q = String(body.query || "react frontend developer").trim().slice(0, 120);
  const loc = String(body.location || "India").trim().slice(0, 80);
  const focus = String(body.focus || "boards");
  const limit = Math.max(1, Math.min(Math.floor(Number(body.limit)) || 60, MAX_LIMIT));
  const years = Number(body.yearsExperience);
  const started = Date.now();

  // The client sends role variants built from the profile ("react developer",
  // "ui engineer", …). Aggregators return very different results per phrasing,
  // so searching several is the cheapest way to widen the net.
  const extra: string[] = Array.isArray(body.queries)
    ? body.queries.map((s: unknown) => String(s).trim().slice(0, 120)).filter(Boolean)
    : [];
  const queries = Array.from(new Set([q, ...extra])).slice(0, 4);

  const wantsBoards = focus === "boards" || focus === "yc" || focus === "all";
  const wantsAggregators = focus === "portals" || focus === "all";

  // A set, because every failed query variant reports the same thing.
  const warnings = new Set<string>();
  const warn = (m: string) => void warnings.add(m);

  const [boards, jsearch, adzuna] = await Promise.all([
    wantsBoards
      ? searchCompanyBoards({
          query: q,
          variants: queries,
          years: Number.isFinite(years) ? years : undefined,
          deadline: started + BOARD_DEADLINE_MS,
          location: loc,
          ycOnly: focus === "yc",
          // On "all", boards would otherwise fill the entire result budget
          // before a single portal listing was considered — they are merged
          // first, and there are usually more than `limit` of them.
          limit: focus === "all" ? Math.ceil(limit * 0.6) : limit,
        }).catch(() => [])
      : Promise.resolve([]),
    wantsAggregators ? fromJSearch(queries, loc, warn).catch(() => []) : Promise.resolve([]),
    wantsAggregators ? fromAdzuna(queries, loc, warn).catch(() => []) : Promise.resolve([]),
  ]);

  const boardListings: Listing[] = boards.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    salary: "",
    url: j.url,
    // Lever and Ashby send the posting with the list; Greenhouse descriptions are
    // fetched for the shortlist. Scoring without them was scoring the title.
    description: [j.department ? `Team: ${j.department}` : "", j.description || ""]
      .filter(Boolean)
      .join("\n"),
    // From the company, not from which filter ran. Labelled by filter, a YC job
    // re-found by a plain "Company boards" search was relabelled and vanished
    // from the Y Combinator filter it had been found under.
    source: j.yc ? "yc-boards" : "company-boards",
    postedAt: j.postedAt,
  }));

  // Boards first: dedupe keeps the first copy, and a direct ATS link beats an
  // aggregator's redirect to the same role every time.
  const merged = dedupeJobs([
    ...clean(boardListings, loc),
    ...clean(jsearch, loc, true),
    ...clean(adzuna, loc, true),
  ]).slice(0, limit);

  if (!merged.length) {
    return Response.json({ available: false, listings: [], warnings: Array.from(warnings) });
  }

  const counts: Record<string, number> = {};
  for (const l of merged) counts[l.source] = (counts[l.source] || 0) + 1;

  return Response.json({
    available: true,
    // Kept for older clients that read a single source name.
    source: Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0],
    counts,
    listings: merged,
    warnings: Array.from(warnings),
  });
}
