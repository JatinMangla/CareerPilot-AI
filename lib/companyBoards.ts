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
  /** The requirements-bearing part of the job description, as plain text. */
  description?: string;
  /** Greenhouse only: where the full posting is, fetched for the final shortlist. */
  detailUrl?: string;
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
 * "salesforce" is listed because `\bsales\b` does not fire on it.
 *
 * A title that is ALSO clearly frontend work survives this: "Frontend Platform
 * Engineer" used to be dropped for containing "platform engineer".
 */
const EXCLUDE_RE =
  /\b(sales|salesforce|account executive|recruit|talent|marketing|content|seo|people ops|finance|accounting|legal|counsel|support engineer|customer success|solutions? (engineer|architect|consultant)|developer advocate|technical writer|program manager|product manager|project manager|data scientist|machine learning|research scientist|security engineer|site reliability|devops|infrastructure engineer|platform engineer|quality assurance|test engineer|hardware|mechanical|electrical|firmware|intern|internship)\b/i;

/** Only a Director/VP/Head/Manager title is out of reach whatever the experience. */
const ALWAYS_TOO_SENIOR_RE = /\b(director|vp|vice president|head of|manager|distinguished|fellow)\b/i;
/** Individual-contributor levels that need roughly eight years or more. */
const STAFF_RE = /\b(staff|principal|architect)\b/i;

/**
 * Words that say nothing about the role. The search box's words used to admit
 * any title containing them, so the default query's "developer" let in
 * "Salesforce Developer" and "engineer" let in every backend and iOS role.
 */
const GENERIC_TERMS = new Set([
  "developer",
  "developers",
  "engineer",
  "engineers",
  "engineering",
  "software",
  "senior",
  "junior",
  "lead",
  "jobs",
  "job",
  "role",
  "roles",
  "remote",
  "india",
  "hiring",
]);

function roleRank(title: string): number {
  const t = title.toLowerCase();
  if (STRONG_HINTS.some((h) => t.includes(h))) return 2;
  if (WEAK_HINTS.some((h) => t.includes(h))) return 1;
  return 0;
}

/**
 * Is this title at the wrong level for someone with `years` of experience?
 * 0 = right level, 1 = a stretch either way. "Senior" in India often means
 * three to five years, so it is a stretch only for someone newer than that —
 * and for someone past it, a junior title is the stretch.
 */
function levelMismatch(title: string, years: number): number {
  const senior = /\b(senior|sr\.?|lead|iii|iv)\b/i.test(title);
  const junior = /\b(junior|jr\.?|associate|entry|graduate|fresher|trainee)\b/i.test(title);
  if (years >= 4) return junior ? 1 : 0;
  return senior ? 1 : 0;
}

/**
 * Does this role plausibly suit the candidate?
 *
 * `extraTerms` are the words from the search box, so a search for "node backend"
 * still finds work even though nothing in it is a frontend hint.
 */
export function matchesRole(title: string, extraTerms: string[], years = 2): boolean {
  const t = title.toLowerCase();
  const rank = roleRank(title);
  if (EXCLUDE_RE.test(t) && rank < 2) return false;
  if (ALWAYS_TOO_SENIOR_RE.test(t)) return false;
  if (STAFF_RE.test(t) && years < 8) return false;
  if (rank > 0) return true;
  return extraTerms.some((w) => w.length > 3 && !GENERIC_TERMS.has(w) && t.includes(w));
}

/* ---------------- descriptions ---------------- */

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Greenhouse returns HTML with its tags entity-escaped; reduce either to text. */
export function htmlToText(html: string): string {
  const decoded = (html || "").replace(/&(lt|gt|amp|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
  return decoded
    .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(lt|gt|amp|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const REQUIREMENTS_RE =
  /(requirements|qualifications|what you('|’)ll need|what we('|’)re looking for|you have|you bring|must have|about you|who you are|experience with|\d\+?\s*years)/i;

/**
 * The part of a description worth scoring against. Postings open with a company
 * pitch; the first 1,500 characters are often nothing but that, and the stack and
 * years sit further down. Starts a little before the requirements when it can
 * find them.
 */
export function jdExcerpt(text: string, max = 1800): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  const at = t.search(REQUIREMENTS_RE);
  const start = at > 200 ? at - 200 : 0;
  return t.slice(start, start + max);
}

/* ---------------- fetching ---------------- */

/** Board contents change slowly; a search reads a cached copy for this long. */
const BOARD_REVALIDATE_SEC = 30 * 60;

async function fetchJson(
  url: string,
  ms: number,
  revalidate = BOARD_REVALIDATE_SEC
): Promise<any | null> {
  if (ms <= 0) return null;
  try {
    // The timeout covers reading the body too: large boards (Stripe, Airbnb) are
    // megabytes, and clearing the timer at the headers left that part unbounded.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      // Vercel's data cache: repeated searches stop re-downloading ~15k postings.
      // Responses over its 2MB item limit simply aren't cached.
      next: { revalidate },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function leverText(j: any): string {
  const lists = Array.isArray(j.lists)
    ? j.lists.map((l: any) => `${l.text || ""}:\n${htmlToText(l.content || "")}`).join("\n")
    : "";
  return [j.descriptionPlain || "", lists, j.additionalPlain || ""].filter(Boolean).join("\n");
}

async function fetchBoard(board: CompanyBoard, ms: number): Promise<BoardListing[]> {
  if (board.ats === "greenhouse") {
    const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs`, ms);
    return (data?.jobs || []).map((j: any) => ({
      id: `gh-${board.slug}-${j.id}`,
      title: j.title,
      company: board.name,
      location: j.location?.name || "",
      url: j.absolute_url,
      // updated_at moves whenever a recruiter edits an old posting, which made
      // stale roles rank as new. first_published is when it actually went up.
      postedAt: j.first_published || j.updated_at,
      ats: "greenhouse",
      yc: !!board.yc,
      department: j.departments?.[0]?.name || "",
      // The list endpoint carries no description; `?content=true` would make
      // every board several megabytes. Fetched per job, for the shortlist only.
      detailUrl: `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs/${j.id}`,
    }));
  }

  if (board.ats === "lever") {
    const data = await fetchJson(`https://api.lever.co/v0/postings/${board.slug}?mode=json`, ms);
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
      // Lever sends the full posting in the list — it was being downloaded and
      // thrown away while the AI scored the job from its title alone.
      description: jdExcerpt(leverText(j)),
    }));
  }

  const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${board.slug}`, ms);
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
    description: jdExcerpt(j.descriptionPlain || htmlToText(j.descriptionHtml || "")),
  }));
}

/**
 * Reads every board with a bounded number of requests open at once, and stops
 * starting new ones at the deadline — a search that returns 90% of the boards is
 * better than one killed by the function timeout with nothing.
 *
 * `Promise.allSettled` over all of them at once was fine at 22 boards and starts
 * timing out its own requests at 120 — the later fetches spend their budget
 * queued behind the earlier ones rather than in flight.
 */
async function fetchAllBoards(
  boards: CompanyBoard[],
  deadline: number,
  concurrency = 20
): Promise<BoardListing[]> {
  const all: BoardListing[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= boards.length) return;
      const left = deadline - Date.now();
      if (left < 1000) return;
      try {
        all.push(...(await fetchBoard(boards[i], Math.min(9000, left))));
      } catch {
        /* one dead board must not take the whole search down */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  return all;
}

/** Fills in Greenhouse descriptions for the listings that made the cut. */
async function fillGreenhouseDescriptions(list: BoardListing[], deadline: number) {
  const todo = list.filter((j) => j.detailUrl && !j.description);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const left = deadline - Date.now();
      if (left < 800) return;
      const data = await fetchJson(todo[i].detailUrl!, Math.min(6000, left), 6 * 60 * 60);
      if (data?.content) todo[i].description = jdExcerpt(htmlToText(data.content));
    }
  };
  await Promise.all(Array.from({ length: Math.min(20, todo.length) }, worker));
}

/** Fetches every board in parallel and returns roles matching the search. */
export async function searchCompanyBoards(opts: {
  query: string;
  /** Other phrasings of the role, from the profile. */
  variants?: string[];
  location?: string;
  ycOnly?: boolean;
  limit?: number;
  /** Candidate's years of experience; decides which levels are reachable. */
  years?: number;
  /** Epoch ms after which no new request starts. */
  deadline?: number;
}): Promise<BoardListing[]> {
  const { query, location, ycOnly, limit = 60 } = opts;
  const years = Number.isFinite(opts.years) ? Number(opts.years) : 2;
  const deadline = opts.deadline ?? Date.now() + 40_000;
  const boards = ycOnly ? COMPANY_BOARDS.filter((b) => b.yc) : COMPANY_BOARDS;
  const terms = [query, ...(opts.variants || [])]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z.]+/)
    .filter(Boolean);

  const all = await fetchAllBoards(boards, deadline);

  // Location matching is shared with the aggregator results in the API route, so
  // a job is judged reachable by the same rule wherever it came from.
  const matched = all.filter(
    (j) =>
      j.title &&
      j.url &&
      matchesRole(j.title, terms, years) &&
      matchesLocation(j.location, location || "")
  );

  // Frontend-specific roles first, then the ones at the right level, then
  // India-based over remote, then freshest.
  matched.sort((a, b) => {
    const rank = roleRank(b.title) - roleRank(a.title);
    if (rank !== 0) return rank;
    const level = levelMismatch(a.title, years) - levelMismatch(b.title, years);
    if (level !== 0) return level;
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
  const shortlist = dedupeJobs(matched).slice(0, limit);
  await fillGreenhouseDescriptions(shortlist, deadline + 8_000);
  return shortlist;
}
