/**
 * Field intelligence: works out what each form field wants, and what to type in it.
 *
 * Rather than hard-coding selectors per company, we read every visible field's
 * label / aria-label / placeholder / name and match it against intent patterns.
 * This makes one code path work across Greenhouse, Lever, Ashby, Workable and
 * most bespoke career pages.
 */

/** Intent patterns, most specific first — order matters. */
const INTENTS = [
  ["first_name", /\b(first\s*name|given\s*name|fname)\b/i],
  ["last_name", /\b(last\s*name|surname|family\s*name|lname)\b/i],
  ["full_name", /\b(full\s*name|your\s*name|^name$|candidate\s*name)\b/i],
  ["email", /\b(e-?mail)\b/i],
  ["phone", /\b(phone|mobile|contact\s*number|telephone|cell)\b/i],
  ["linkedin", /\blinked\s*in\b/i],
  ["github", /\b(github|git\s*hub)\b/i],
  ["portfolio", /\b(portfolio|personal\s*(site|website)|website|url|blog)\b/i],
  ["location", /\b(location|city|current\s*residence|where.*based|address)\b/i],
  ["cover_letter", /\b(cover\s*letter|why.*(interest|apply|join|company|role)|motivation|tell us about|additional information|anything else)\b/i],
  ["notice_period", /\b(notice\s*period|when.*(start|available)|availability|joining)\b/i],
  ["salary", /\b(salary|compensation|ctc|expected\s*pay|rate)\b/i],
  ["experience_years", /\b(years?\s*of\s*experience|total\s*experience|yoe)\b/i],
  ["company", /\b(current\s*(company|employer)|organization|employer)\b/i],
  ["relocate", /\b(relocat|willing.*move)\b/i],
  ["authorized", /\b(authoriz|eligible.*work|work\s*permit|visa|sponsorship)\b/i],
  ["how_heard", /\b(how did you (hear|find)|source|referr)\b/i],
  ["pronouns", /\bpronoun/i],
  ["gender", /\bgender\b/i],
  ["race", /\b(race|ethnicity)\b/i],
  ["veteran", /\bveteran\b/i],
  ["disability", /\bdisabilit/i],
];

/** Fields we never touch — voluntary EEO / demographic questions. */
const SKIP_INTENTS = new Set(["gender", "race", "veteran", "disability", "pronouns"]);

export function classify(labelText) {
  const text = (labelText || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  for (const [intent, re] of INTENTS) {
    if (re.test(text)) return intent;
  }
  return null;
}

/** Split a full name into first/last. */
function splitName(name) {
  const parts = (name || "").trim().split(/\s+/);
  return {
    first: parts[0] || "",
    last: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

/**
 * Fuzzy-match a form question against the AI-prepared screening answers.
 * Returns { answer, confidence } or null.
 */
export function matchPreparedAnswer(labelText, screeningAnswers = []) {
  const raw = (labelText || "").toLowerCase().replace(/\*/g, "").trim();
  if (!raw) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const text = norm(raw);

  // 1. near-exact: one contains the other (handles "Expected CTC" ↔ "Expected CTC?")
  for (const qa of screeningAnswers) {
    const q = norm(qa.question || "");
    if (!q) continue;
    if (q === text || (text.length > 4 && q.includes(text)) || (q.length > 4 && text.includes(q))) {
      return qa;
    }
  }

  // 2. keyword overlap, scaled to how many keywords the label actually has
  const words = text.split(" ").filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return null;
  let best = null;
  let bestScore = 0;
  const need = words.length <= 2 ? 1 : 2;
  for (const qa of screeningAnswers) {
    const q = norm(qa.question || "");
    let hits = 0;
    for (const w of words) if (q.includes(w)) hits++;
    const ratio = hits / words.length;
    if (hits >= need && ratio > bestScore) {
      bestScore = ratio;
      best = qa;
    }
  }
  return best;
}

const STOP = new Set([
  "what", "your", "the", "you", "are", "for", "with", "and", "any", "our",
  "please", "this", "that", "have", "has", "how", "why", "will", "would",
  "select", "choose", "enter", "optional", "required", "years", "year",
]);

/**
 * Decide the value for a classified field.
 * Returns { value, confidence } or null to skip.
 */
export function valueFor(intent, labelText, app, profile) {
  if (!intent || SKIP_INTENTS.has(intent)) return null;

  const { first, last } = splitName(profile.name);

  switch (intent) {
    case "first_name":
      return { value: first, confidence: "high" };
    case "last_name":
      return { value: last, confidence: "high" };
    case "full_name":
      return { value: profile.name, confidence: "high" };
    case "email":
      return { value: profile.email, confidence: "high" };
    case "phone":
      return profile.phone ? { value: profile.phone, confidence: "high" } : null;
    case "linkedin":
      return profile.linkedin ? { value: profile.linkedin, confidence: "high" } : null;
    case "github":
      return profile.github ? { value: profile.github, confidence: "high" } : null;
    case "portfolio":
      return profile.portfolio ? { value: profile.portfolio, confidence: "high" } : null;
    case "location":
      return profile.location ? { value: profile.location, confidence: "high" } : null;
    case "cover_letter":
      return app.coverLetter ? { value: app.coverLetter, confidence: "high" } : null;
    case "notice_period":
      if (profile.noticePeriod) return { value: profile.noticePeriod, confidence: "high" };
      break;
    case "salary":
      if (profile.expectedCtc) return { value: profile.expectedCtc, confidence: "high" };
      break;
    default:
      break;
  }

  // Fall back to the AI-prepared screening answers for anything not covered above
  // (experience, relocation, work authorization, how-did-you-hear, notice, salary…).
  const prepared = matchPreparedAnswer(labelText, app.screeningAnswers);
  if (prepared) {
    return {
      value: prepared.answer,
      confidence: prepared.confidence === "high" ? "high" : "low",
    };
  }
  return null;
}

export { SKIP_INTENTS };
