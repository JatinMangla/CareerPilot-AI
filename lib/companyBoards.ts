/**
 * Company ATS job boards.
 *
 * Greenhouse, Lever and Ashby each expose a company's live openings as public
 * JSON — no API key, no account, no scraping. This is the highest-quality job
 * source available to us: the listings are first-party and current, and the
 * apply URLs land on the exact ATS platforms the Auto-Pilot agent can submit
 * to automatically.
 *
 * Every slug below was probed against the live API and returned postings. The
 * list started at 22 companies, which is why "Find my matches" only ever
 * surfaced a handful of roles: after the role and location filters, twenty-odd
 * boards simply do not contain many frontend jobs open to India. It is now
 * ~120 boards / 15k+ live postings, which is what makes a real search possible.
 */

import { dedupeJobs, matchesLocation, INDIA_RE } from "./jobFilters";

export interface CompanyBoard {
  slug: string;
  name: string;
  ats: "greenhouse" | "lever" | "ashby";
  /** Y Combinator-backed. Only set where the company is unambiguously YC. */
  yc?: boolean;
  /** Known to hire in India, or hires remotely from India. */
  india?: boolean;
}

export const COMPANY_BOARDS: CompanyBoard[] = [
  // ---- India-based / heavy India hiring ----
  { slug: "razorpaysoftwareprivatelimited", name: "Razorpay", ats: "greenhouse", yc: true, india: true },
  { slug: "groww", name: "Groww", ats: "greenhouse", yc: true, india: true },
  { slug: "postman", name: "Postman", ats: "greenhouse", india: true },
  { slug: "zetaglobal", name: "Zeta", ats: "greenhouse", india: true },
  { slug: "truecaller", name: "Truecaller", ats: "greenhouse", india: true },
  { slug: "hackerrank", name: "HackerRank", ats: "greenhouse", yc: true, india: true },
  { slug: "thoughtworks", name: "Thoughtworks", ats: "greenhouse", india: true },
  { slug: "turing", name: "Turing", ats: "greenhouse", india: true },
  { slug: "paytm", name: "Paytm", ats: "lever", india: true },
  { slug: "meesho", name: "Meesho", ats: "lever", yc: true, india: true },
  { slug: "cred", name: "CRED", ats: "lever", india: true },
  { slug: "mindtickle", name: "MindTickle", ats: "lever", india: true },
  { slug: "porter", name: "Porter", ats: "lever", india: true },
  { slug: "fi", name: "Fi Money", ats: "lever", india: true },
  { slug: "navi", name: "Navi", ats: "ashby", india: true },
  { slug: "atlan", name: "Atlan", ats: "ashby", india: true },
  { slug: "spotdraft", name: "SpotDraft", ats: "ashby", india: true },

  // ---- YC-backed, hire from India or fully remote ----
  { slug: "stripe", name: "Stripe", ats: "greenhouse", yc: true, india: true },
  { slug: "coinbase", name: "Coinbase", ats: "greenhouse", yc: true, india: true },
  { slug: "instacart", name: "Instacart", ats: "greenhouse", yc: true },
  { slug: "dropbox", name: "Dropbox", ats: "greenhouse", yc: true, india: true },
  { slug: "brex", name: "Brex", ats: "greenhouse", yc: true },
  { slug: "gitlab", name: "GitLab", ats: "greenhouse", yc: true, india: true },
  { slug: "airbnb", name: "Airbnb", ats: "greenhouse", yc: true, india: true },
  { slug: "reddit", name: "Reddit", ats: "greenhouse", yc: true },
  { slug: "twitch", name: "Twitch", ats: "greenhouse", yc: true },
  { slug: "flexport", name: "Flexport", ats: "greenhouse", yc: true, india: true },
  { slug: "faire", name: "Faire", ats: "greenhouse", yc: true },
  { slug: "scaleai", name: "Scale AI", ats: "greenhouse", yc: true, india: true },
  { slug: "gusto", name: "Gusto", ats: "greenhouse", yc: true, india: true },
  { slug: "webflow", name: "Webflow", ats: "greenhouse", yc: true, india: true },
  { slug: "amplitude", name: "Amplitude", ats: "greenhouse", yc: true, india: true },
  { slug: "mixpanel", name: "Mixpanel", ats: "greenhouse", yc: true, india: true },
  { slug: "replit", name: "Replit", ats: "ashby", yc: true, india: true },
  { slug: "supabase", name: "Supabase", ats: "ashby", yc: true, india: true },
  { slug: "render", name: "Render", ats: "ashby", yc: true, india: true },
  { slug: "railway", name: "Railway", ats: "ashby", yc: true, india: true },
  { slug: "resend", name: "Resend", ats: "ashby", yc: true, india: true },
  { slug: "cursor", name: "Cursor (Anysphere)", ats: "ashby", yc: true },
  { slug: "posthog", name: "PostHog", ats: "ashby", yc: true, india: true },

  // ---- Remote-first / global engineering ----
  { slug: "vercel", name: "Vercel", ats: "greenhouse", india: true },
  { slug: "figma", name: "Figma", ats: "greenhouse", india: true },
  { slug: "cloudflare", name: "Cloudflare", ats: "greenhouse", india: true },
  { slug: "datadog", name: "Datadog", ats: "greenhouse", india: true },
  { slug: "mongodb", name: "MongoDB", ats: "greenhouse", india: true },
  { slug: "elastic", name: "Elastic", ats: "greenhouse", india: true },
  { slug: "twilio", name: "Twilio", ats: "greenhouse", india: true },
  { slug: "airtable", name: "Airtable", ats: "greenhouse", india: true },
  { slug: "asana", name: "Asana", ats: "greenhouse", india: true },
  { slug: "robinhood", name: "Robinhood", ats: "greenhouse", india: true },
  { slug: "cockroachlabs", name: "Cockroach Labs", ats: "greenhouse", india: true },
  { slug: "remote", name: "Remote.com", ats: "greenhouse", india: true },
  { slug: "lyft", name: "Lyft", ats: "greenhouse", india: true },
  { slug: "pinterest", name: "Pinterest", ats: "greenhouse" },
  { slug: "discord", name: "Discord", ats: "greenhouse" },
  { slug: "affirm", name: "Affirm", ats: "greenhouse", india: true },
  { slug: "samsara", name: "Samsara", ats: "greenhouse", india: true },
  { slug: "databricks", name: "Databricks", ats: "greenhouse", india: true },
  { slug: "grafanalabs", name: "Grafana Labs", ats: "greenhouse", india: true },
  { slug: "sumologic", name: "Sumo Logic", ats: "greenhouse", india: true },
  { slug: "newrelic", name: "New Relic", ats: "greenhouse", india: true },
  { slug: "chime", name: "Chime", ats: "greenhouse" },
  { slug: "carta", name: "Carta", ats: "greenhouse", india: true },
  { slug: "anthropic", name: "Anthropic", ats: "greenhouse", india: true },
  { slug: "duolingo", name: "Duolingo", ats: "greenhouse" },
  { slug: "calendly", name: "Calendly", ats: "greenhouse", india: true },
  { slug: "udemy", name: "Udemy", ats: "greenhouse", india: true },
  { slug: "coursera", name: "Coursera", ats: "greenhouse", india: true },
  { slug: "khanacademy", name: "Khan Academy", ats: "greenhouse", india: true },
  { slug: "lucidsoftware", name: "Lucid Software", ats: "greenhouse", india: true },
  { slug: "peloton", name: "Peloton", ats: "greenhouse", india: true },
  { slug: "tripadvisor", name: "Tripadvisor", ats: "greenhouse", india: true },
  { slug: "roblox", name: "Roblox", ats: "greenhouse", india: true },
  { slug: "epicgames", name: "Epic Games", ats: "greenhouse", india: true },
  { slug: "okta", name: "Okta", ats: "greenhouse", india: true },
  { slug: "smartsheet", name: "Smartsheet", ats: "greenhouse", india: true },
  { slug: "klaviyo", name: "Klaviyo", ats: "greenhouse", india: true },
  { slug: "toast", name: "Toast", ats: "greenhouse", india: true },
  { slug: "verkada", name: "Verkada", ats: "greenhouse", india: true },
  { slug: "rubrik", name: "Rubrik", ats: "greenhouse", india: true },
  { slug: "storyblok", name: "Storyblok", ats: "greenhouse", india: true },
  { slug: "algolia", name: "Algolia", ats: "greenhouse", india: true },
  { slug: "typeform", name: "Typeform", ats: "greenhouse" },
  { slug: "celonis", name: "Celonis", ats: "greenhouse", india: true },
  { slug: "squarespace", name: "Squarespace", ats: "greenhouse" },
  { slug: "tanium", name: "Tanium", ats: "greenhouse", india: true },
  { slug: "huntress", name: "Huntress", ats: "greenhouse", india: true },
  { slug: "chainguard", name: "Chainguard", ats: "greenhouse", india: true },
  { slug: "tailscale", name: "Tailscale", ats: "greenhouse", india: true },
  { slug: "fastly", name: "Fastly", ats: "greenhouse", india: true },
  { slug: "palantir", name: "Palantir", ats: "lever", india: true },
  { slug: "spotify", name: "Spotify", ats: "lever", india: true },
  { slug: "matchgroup", name: "Match Group", ats: "lever", india: true },
  { slug: "ro", name: "Ro", ats: "lever" },
  { slug: "wealthfront", name: "Wealthfront", ats: "lever" },
  { slug: "secureframe", name: "Secureframe", ats: "lever", india: true },
  { slug: "ninjavan", name: "Ninja Van", ats: "lever", india: true },
  { slug: "ramp", name: "Ramp", ats: "ashby", india: true },
  { slug: "linear", name: "Linear", ats: "ashby" },
  { slug: "vanta", name: "Vanta", ats: "ashby", india: true },
  { slug: "openai", name: "OpenAI", ats: "ashby", india: true },
  { slug: "notion", name: "Notion", ats: "ashby", india: true },
  { slug: "sardine", name: "Sardine", ats: "ashby", india: true },
  { slug: "perplexity", name: "Perplexity", ats: "ashby", india: true },
  { slug: "warp", name: "Warp", ats: "ashby" },
  { slug: "browserbase", name: "Browserbase", ats: "ashby" },
  { slug: "modal", name: "Modal", ats: "ashby" },
  { slug: "temporal", name: "Temporal", ats: "ashby", india: true },
  { slug: "prefect", name: "Prefect", ats: "ashby", india: true },
  { slug: "astronomer", name: "Astronomer", ats: "ashby", india: true },
  { slug: "pinecone", name: "Pinecone", ats: "ashby", india: true },
  { slug: "cohere", name: "Cohere", ats: "ashby", india: true },
  { slug: "elevenlabs", name: "ElevenLabs", ats: "ashby", india: true },
  { slug: "synthesia", name: "Synthesia", ats: "ashby", india: true },
  { slug: "sierra", name: "Sierra", ats: "ashby" },
  { slug: "harvey", name: "Harvey", ats: "ashby", india: true },
  { slug: "abridge", name: "Abridge", ats: "ashby" },
  { slug: "baseten", name: "Baseten", ats: "ashby", india: true },
  { slug: "lightning", name: "Lightning AI", ats: "ashby", india: true },
  { slug: "qonto", name: "Qonto", ats: "ashby" },
  { slug: "pennylane", name: "Pennylane", ats: "ashby" },
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
  /** Team / department, where the ATS exposes it — useful context for scoring. */
  department?: string;
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
  "ui developer",
  "web engineer",
  "web developer",
  "next.js",
  "nextjs",
  "angular",
  "vue",
  "design engineer",
  "product engineer",
];

/** Plausible but not frontend-specific — kept, but ranked lower. */
const WEAK_HINTS = [
  "fullstack",
  "full stack",
  "full-stack",
  "software engineer",
  "software developer",
  "application engineer",
  "member of technical staff",
  "sde",
  "mobile engineer",
  "react native",
];

/**
 * Non-engineering roles that share vocabulary with engineering titles
 * ("Sales Engineer", "Developer Advocate", "Technical Recruiter") and would
 * otherwise flood the list now that 120 boards are read instead of 22.
 */
const EXCLUDE_RE =
  /\b(sales|account executive|recruit|talent|marketing|content|seo|people ops|finance|accounting|legal|counsel|support engineer|customer success|solutions? (engineer|architect|consultant)|developer advocate|technical writer|program manager|product manager|project manager|data scientist|machine learning|research scientist|security engineer|site reliability|devops|infrastructure engineer|platform engineer|quality assurance|test engineer|hardware|mechanical|electrical|firmware|intern|internship)\b/i;

/** Too senior for a 1-3 year candidate — these are a guaranteed rejection. */
const TOO_SENIOR_RE =
  /\b(staff|principal|director|vp|vice president|head of|manager|architect|distinguished|fellow)\b/i;

function roleRank(title: string): number {
  const t = title.toLowerCase();
  if (STRONG_HINTS.some((h) => t.includes(h))) return 2;
  if (WEAK_HINTS.some((h) => t.includes(h))) return 1;
  return 0;
}

/**
 * Roles asking for more experience than the candidate has are still worth
 * showing — "Senior" in India often means three years — but they should not
 * push the roles that actually fit off the top of the list.
 */
function seniorityPenalty(title: string): number {
  return /\b(senior|sr\.?|lead|iii|iv)\b/i.test(title) ? 1 : 0;
}

/**
 * Does this role plausibly suit the candidate?
 *
 * `extraTerms` are the words from the search box, so a search for "node backend"
 * still finds work even though nothing in it is a frontend hint.
 */
export function matchesRole(title: string, extraTerms: string[]): boolean {
  const t = title.toLowerCase();
  if (EXCLUDE_RE.test(t)) return false;
  // "Senior Frontend Engineer" is worth a shot; "Engineering Manager" is not.
  if (TOO_SENIOR_RE.test(t)) return false;
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
      department: j.departments?.[0]?.name || "",
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
      department: j.categories?.team || "",
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
    department: j.department || j.team || "",
  }));
}

/**
 * Reads every board with a bounded number of requests open at once.
 *
 * `Promise.allSettled` over all of them at once was fine at 22 boards and starts
 * timing out its own requests at 120 — the later fetches spend their 9s budget
 * queued behind the earlier ones rather than in flight.
 */
async function fetchAllBoards(
  boards: CompanyBoard[],
  concurrency = 20
): Promise<BoardListing[]> {
  const all: BoardListing[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= boards.length) return;
      try {
        all.push(...(await fetchBoard(boards[i])));
      } catch {
        /* one dead board must not take the whole search down */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  return all;
}

/** Fetches every board in parallel and returns roles matching the search. */
export async function searchCompanyBoards(opts: {
  query: string;
  location?: string;
  ycOnly?: boolean;
  limit?: number;
}): Promise<BoardListing[]> {
  const { query, location, ycOnly, limit = 60 } = opts;
  const boards = ycOnly ? COMPANY_BOARDS.filter((b) => b.yc) : COMPANY_BOARDS;
  const terms = query.toLowerCase().split(/[^a-z.]+/).filter(Boolean);

  const all = await fetchAllBoards(boards);

  // Location matching is shared with the aggregator results in the API route, so
  // a job is judged reachable by the same rule wherever it came from.
  const matched = all.filter(
    (j) =>
      j.title &&
      j.url &&
      matchesRole(j.title, terms) &&
      matchesLocation(j.location, location || "")
  );

  // Frontend-specific roles first, then the ones at the right level, then
  // India-based over remote, then freshest.
  matched.sort((a, b) => {
    const rank = roleRank(b.title) - roleRank(a.title);
    if (rank !== 0) return rank;
    const seniority = seniorityPenalty(a.title) - seniorityPenalty(b.title);
    if (seniority !== 0) return seniority;
    const aIn = INDIA_RE.test(a.location) ? 1 : 0;
    const bIn = INDIA_RE.test(b.location) ? 1 : 0;
    if (aIn !== bIn) return bIn - aIn;
    return +new Date(b.postedAt || 0) - +new Date(a.postedAt || 0);
  });

  /*
   * Dedupe BEFORE the limit, not after.
   *
   * A big company posts the same title as five separate reqs for five teams
   * ("Senior Software Engineer" x5 at Okta). Slicing first spent most of the
   * result budget on copies of one job — the user's "why am I seeing the same
   * job over and over" — and then had nothing left for the other 120 boards.
   */
  return dedupeJobs(matched).slice(0, limit);
}
