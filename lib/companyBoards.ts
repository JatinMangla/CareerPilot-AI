/**
 * Company ATS job boards.
 *
 * Greenhouse, Lever and Ashby each expose a company's live openings as public
 * JSON — no API key, no account, no scraping. This is the highest-quality job
 * source available to us: the listings are first-party and current, and the
 * apply URLs land on the exact ATS platforms the Auto-Pilot agent can submit
 * to automatically.
 *
 * Every slug below was verified to return postings.
 */

export interface CompanyBoard {
  slug: string;
  name: string;
  ats: "greenhouse" | "lever" | "ashby";
  /** Y Combinator-backed (batch noted where well known). */
  yc?: boolean;
  /** Hires in India, or hires remotely from India. */
  india?: boolean;
}

export const COMPANY_BOARDS: CompanyBoard[] = [
  // ---- India-based / India-hiring ----
  { slug: "razorpaysoftwareprivatelimited", name: "Razorpay", ats: "greenhouse", yc: true, india: true },
  { slug: "groww", name: "Groww", ats: "greenhouse", yc: true, india: true },
  { slug: "postman", name: "Postman", ats: "greenhouse", india: true },
  { slug: "phonepe", name: "PhonePe", ats: "greenhouse", india: true },

  // ---- YC-backed, remote-friendly ----
  { slug: "stripe", name: "Stripe", ats: "greenhouse", yc: true, india: true },
  { slug: "coinbase", name: "Coinbase", ats: "greenhouse", yc: true },
  { slug: "instacart", name: "Instacart", ats: "greenhouse", yc: true },
  { slug: "dropbox", name: "Dropbox", ats: "greenhouse", yc: true, india: true },
  { slug: "brex", name: "Brex", ats: "greenhouse", yc: true },
  { slug: "gitlab", name: "GitLab", ats: "greenhouse", yc: true, india: true },

  // ---- Strong remote / global engineering ----
  { slug: "vercel", name: "Vercel", ats: "greenhouse", india: true },
  { slug: "figma", name: "Figma", ats: "greenhouse" },
  { slug: "cloudflare", name: "Cloudflare", ats: "greenhouse", india: true },
  { slug: "datadog", name: "Datadog", ats: "greenhouse", india: true },
  { slug: "mongodb", name: "MongoDB", ats: "greenhouse", india: true },
  { slug: "elastic", name: "Elastic", ats: "greenhouse", india: true },
  { slug: "twilio", name: "Twilio", ats: "greenhouse", india: true },
  { slug: "airtable", name: "Airtable", ats: "greenhouse" },
  { slug: "asana", name: "Asana", ats: "greenhouse", india: true },
  { slug: "robinhood", name: "Robinhood", ats: "greenhouse" },
  { slug: "cockroachlabs", name: "Cockroach Labs", ats: "greenhouse", india: true },
  { slug: "remote", name: "Remote.com", ats: "greenhouse", india: true },
];

export interface BoardListing {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: string;
  ats: string;
  yc: boolean;
}

/** Titles that are unambiguously frontend work. */
const STRONG_HINTS = [
  "frontend",
  "front end",
  "front-end",
  "react",
  "javascript",
  "typescript",
  "ui engineer",
  "web engineer",
  "web developer",
];

/** Plausible but not frontend-specific — kept, but ranked lower. */
const WEAK_HINTS = ["fullstack", "full stack", "full-stack", "software engineer"];

const INDIA_RE =
  /india|bengaluru|bangalore|delhi|gurgaon|gurugram|noida|hyderabad|pune|mumbai|chennai|kolkata|ahmedabad/i;

/**
 * A remote role advertised as "Remote - USA" or "Canada - Remote" is not open
 * to a candidate in India, so a bare "remote" match isn't good enough.
 */
const OTHER_REGION_RE =
  /\b(us|usa|u\.s\.a?|united states|nyc|canada|ireland|estonia|portugal|poland|romania|spain|france|germany|netherlands|uk|united kingdom|europe|australia|singapore|japan|brazil|mexico|argentina|colombia|israel|emea|amer|latam|apac|nordics)\b/i;

function openToIndia(location: string): boolean {
  const l = location.toLowerCase();
  if (INDIA_RE.test(l)) return true;
  if (!l.trim()) return false;
  const remote = /remote|anywhere|global|worldwide|distributed/i.test(l);
  return remote && !OTHER_REGION_RE.test(l);
}

function roleRank(title: string): number {
  const t = title.toLowerCase();
  if (STRONG_HINTS.some((h) => t.includes(h))) return 2;
  if (WEAK_HINTS.some((h) => t.includes(h))) return 1;
  return 0;
}

/** Does this role plausibly suit a frontend/React candidate? */
export function matchesRole(title: string, extraTerms: string[]): boolean {
  const t = title.toLowerCase();
  if (/\b(staff|principal|director|vp|head of|manager|lead)\b/.test(t)) {
    // keep senior ICs out of a junior/mid search, but allow "Senior"
    if (!/senior/.test(t)) return false;
  }
  if (roleRank(title) > 0) return true;
  return extraTerms.some((w) => w.length > 3 && t.includes(w));
}

async function fetchJson(url: string, ms = 9000): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchBoard(board: CompanyBoard): Promise<BoardListing[]> {
  if (board.ats === "greenhouse") {
    const data = await fetchJson(
      `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs`
    );
    return (data?.jobs || []).map((j: any) => ({
      id: `gh-${board.slug}-${j.id}`,
      title: j.title,
      company: board.name,
      location: j.location?.name || "",
      url: j.absolute_url,
      postedAt: j.updated_at,
      ats: "greenhouse",
      yc: !!board.yc,
    }));
  }

  if (board.ats === "lever") {
    const data = await fetchJson(`https://api.lever.co/v0/postings/${board.slug}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j: any) => ({
      id: `lv-${board.slug}-${j.id}`,
      title: j.text,
      company: board.name,
      location: j.categories?.location || "",
      url: j.hostedUrl,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      ats: "lever",
      yc: !!board.yc,
    }));
  }

  const data = await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${board.slug}`
  );
  return (data?.jobs || []).map((j: any) => ({
    id: `ab-${board.slug}-${j.id}`,
    title: j.title,
    company: board.name,
    location: j.location || "",
    url: j.jobUrl,
    postedAt: j.publishedAt,
    ats: "ashby",
    yc: !!board.yc,
  }));
}

/** Fetches every board in parallel and returns roles matching the search. */
export async function searchCompanyBoards(opts: {
  query: string;
  location?: string;
  ycOnly?: boolean;
  limit?: number;
}): Promise<BoardListing[]> {
  const { query, location, ycOnly, limit = 25 } = opts;
  const boards = ycOnly ? COMPANY_BOARDS.filter((b) => b.yc) : COMPANY_BOARDS;
  const terms = query.toLowerCase().split(/[^a-z]+/).filter(Boolean);

  const results = await Promise.allSettled(boards.map(fetchBoard));
  const all: BoardListing[] = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);

  const loc = (location || "").toLowerCase().trim();
  const wantsIndia = loc.includes("india");

  const matched = all.filter((j) => {
    if (!matchesRole(j.title, terms)) return false;
    if (!loc || loc === "remote") return true;
    if (wantsIndia) return openToIndia(j.location);
    const l = j.location.toLowerCase();
    return l.includes(loc) || /remote|anywhere|global/i.test(l);
  });

  // Frontend-specific roles first, then India-based over remote, then freshest.
  matched.sort((a, b) => {
    const rank = roleRank(b.title) - roleRank(a.title);
    if (rank !== 0) return rank;
    const aIn = INDIA_RE.test(a.location) ? 1 : 0;
    const bIn = INDIA_RE.test(b.location) ? 1 : 0;
    if (aIn !== bIn) return bIn - aIn;
    return +new Date(b.postedAt || 0) - +new Date(a.postedAt || 0);
  });

  return matched.slice(0, limit);
}
