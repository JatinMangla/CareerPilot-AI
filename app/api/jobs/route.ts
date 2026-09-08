import { searchCompanyBoards } from "@/lib/companyBoards";
import {
  countryCode,
  dedupeJobs,
  isBlockedListing,
  matchesLocation,
} from "@/lib/jobFilters";

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
 * Returns { available: false } only if nothing at all came back — the client
 * then falls back to AI-researched leads.
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
}

/** Hard ceiling on what one search may return, whatever the client asks for. */
const MAX_LIMIT = 150;

/** Aggregator pages to walk. Each is one API call against a metered quota. */
const AGGREGATOR_PAGES = 3;

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

async function fromJSearch(queries: string[], loc: string): Promise<Listing[]> {
  const key = process.env.OPENWEBNINJA_API_KEY;
  if (!key) return [];
  const out: Listing[] = [];

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
        const res = await fetch(url, { headers: { "X-API-Key": key }, cache: "no-store" });
        if (!res.ok) return;
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
          });
        }
      } catch {
        /* one variant failing must not lose the others */
      }
    })
  );
  return out;
}

async function fromAdzuna(queries: string[], loc: string): Promise<Listing[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return [];
  const out: Listing[] = [];

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
            { cache: "no-store" }
          );
          if (!res.ok) return;
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
            });
          }
        } catch {
          /* skip this page */
        }
      })
    )
  );
  return out;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}) as any);
  const q = String(body.query || "react frontend developer").trim();
  const loc = String(body.location || "India").trim();
  const focus = String(body.focus || "boards");
  const limit = Math.min(Number(body.limit) || 60, MAX_LIMIT);

  // The client sends role variants built from the profile ("react developer",
  // "ui engineer", …). Aggregators return very different results per phrasing,
  // so searching several is the cheapest way to widen the net.
  const extra: string[] = Array.isArray(body.queries)
    ? body.queries.map((s: unknown) => String(s).trim()).filter(Boolean)
    : [];
  const queries = Array.from(new Set([q, ...extra])).slice(0, 4);

  const wantsBoards = focus === "boards" || focus === "yc" || focus === "all";
  const wantsAggregators = focus === "portals" || focus === "all";

  const [boards, jsearch, adzuna] = await Promise.all([
    wantsBoards
      ? searchCompanyBoards({
          query: q,
          location: loc,
          ycOnly: focus === "yc",
          // On "all", boards would otherwise fill the entire result budget
          // before a single portal listing was considered — they are merged
          // first, and there are usually more than `limit` of them.
          limit: focus === "all" ? Math.ceil(limit * 0.6) : limit,
        }).catch(() => [])
      : Promise.resolve([]),
    wantsAggregators ? fromJSearch(queries, loc).catch(() => []) : Promise.resolve([]),
    wantsAggregators ? fromAdzuna(queries, loc).catch(() => []) : Promise.resolve([]),
  ]);

  const boardSource = focus === "yc" ? "yc-boards" : "company-boards";
  const boardListings: Listing[] = boards.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    salary: "",
    url: j.url,
    // The board APIs do not return the body cheaply, but the team name is real
    // context and measurably improves the AI's match scoring.
    description: j.department ? `Team: ${j.department}` : "",
    source: boardSource,
  }));

  // Boards first: dedupe keeps the first copy, and a direct ATS link beats an
  // aggregator's redirect to the same role every time.
  const merged = dedupeJobs([
    ...clean(boardListings, loc),
    ...clean(jsearch, loc, true),
    ...clean(adzuna, loc, true),
  ]).slice(0, limit);

  if (!merged.length) return Response.json({ available: false, listings: [] });

  const counts: Record<string, number> = {};
  for (const l of merged) counts[l.source] = (counts[l.source] || 0) + 1;

  return Response.json({
    available: true,
    // Kept for older clients that read a single source name.
    source: Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0],
    counts,
    listings: merged,
  });
}
