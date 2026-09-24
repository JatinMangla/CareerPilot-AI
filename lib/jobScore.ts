import type { Profile } from "./types";

/**
 * A quick, deterministic fit score for a listing — no AI call.
 *
 * Why it exists: every listing used to go to the AI in batches of eight, so a
 * 150-job search spent ~19 calls (about 8% of the free day) before you saw
 * anything, and the "match score" for board jobs was a guess from the title
 * because the description was never fetched. This scores all of them instantly
 * from what is actually in the posting; the AI then analyses the top of the list
 * in depth, where its judgement is worth the call.
 *
 * It is a ranking signal, not a verdict — the reasons it returns say exactly
 * what it saw, so a surprising score can be checked at a glance.
 */

export interface QuickScore {
  score: number;
  /** What helped, in plain words. */
  pros: string[];
  /** What hurt, in plain words. */
  cons: string[];
}

interface ListingLike {
  title: string;
  description?: string;
  location?: string;
  postedAt?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a skill as a whole term: "Go" must not match "Google", "C" not "CSS". */
function skillRe(skill: string): RegExp {
  const s = escapeRe(skill.trim().toLowerCase());
  return new RegExp(`(^|[^a-z0-9+#])${s}($|[^a-z0-9+#])`, "i");
}

/** Skills that are table stakes for almost any web role, so they prove little. */
const COMMON = new Set(["git", "html", "css", "javascript", "agile", "jira"]);

/** "3+ years", "3-5 years", "minimum of 4 yrs" → the lower bound. */
export function requiredYears(text: string): number | null {
  const found: number[] = [];
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:[-–to]+\s*\d{1,2}\s*)?(?:years?|yrs?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20) found.push(n);
  }
  // The smallest stated number is usually the hard floor; larger ones tend to be
  // "5+ years of X preferred" or company age.
  return found.length ? Math.min(...found) : null;
}

export function quickScore(listing: ListingLike, profile: Partial<Profile>): QuickScore {
  const title = (listing.title || "").toLowerCase();
  const desc = listing.description || "";
  const text = `${listing.title} ${desc}`;
  const pros: string[] = [];
  const cons: string[] = [];
  let score = 35;

  // Skills named in the posting that the profile has.
  const skills = (profile.skills || []).filter((s) => s && s.trim().length > 0);
  const hits = skills.filter((s) => skillRe(s).test(text));
  const meaningful = hits.filter((s) => !COMMON.has(s.toLowerCase()));
  if (desc) {
    score += Math.min(30, meaningful.length * 7 + (hits.length - meaningful.length) * 2);
    if (meaningful.length) pros.push(`Mentions your skills: ${meaningful.slice(0, 5).join(", ")}`);
    else cons.push("None of your core skills appear in the posting");
  } else {
    // Title only: a skill in the title is strong evidence, its absence is not.
    score += Math.min(20, meaningful.length * 10);
    if (meaningful.length) pros.push(`Title names ${meaningful.slice(0, 3).join(", ")}`);
    cons.push("No description available — scored from the title only");
  }

  // Desired role words in the title.
  const roleWords = (profile.desiredRoles || profile.role || "")
    .toLowerCase()
    .split(/[^a-z.]+/)
    .filter((w) => w.length > 3 && !["developer", "engineer", "senior", "junior"].includes(w));
  if (roleWords.some((w) => title.includes(w))) {
    score += 12;
    pros.push("Title matches the roles you are targeting");
  }

  // Experience asked for vs experience held.
  const years = typeof profile.yearsExperience === "number" ? profile.yearsExperience : null;
  const needed = requiredYears(desc);
  if (needed !== null && years !== null) {
    if (needed <= years) {
      score += 15;
      pros.push(`Asks for ${needed}+ years; you have ${years}`);
    } else if (needed <= years + 1) {
      score += 3;
      cons.push(`Asks for ${needed}+ years; you have ${years} — a small stretch`);
    } else {
      score -= Math.min(25, (needed - years) * 8);
      cons.push(`Asks for ${needed}+ years; you have ${years}`);
    }
  }

  // Level in the title vs experience.
  if (years !== null) {
    if (/\b(staff|principal|architect)\b/.test(title) && years < 8) {
      score -= 15;
      cons.push("Staff/principal level");
    } else if (/\b(senior|sr\.?|lead)\b/.test(title) && years < 3) {
      score -= 10;
      cons.push("Senior title for your experience");
    } else if (/\b(junior|jr\.?|entry|graduate|fresher|trainee|intern)\b/.test(title) && years >= 4) {
      score -= 8;
      cons.push("Junior level — likely below your experience");
    }
  }

  // Freshness: early applicants get read.
  if (listing.postedAt) {
    const days = (Date.now() - +new Date(listing.postedAt)) / 86_400_000;
    if (Number.isFinite(days)) {
      if (days <= 7) {
        score += 8;
        pros.push("Posted in the last week");
      } else if (days > 60) {
        score -= 6;
        cons.push(`Posted ${Math.round(days)} days ago`);
      }
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), pros, cons };
}
