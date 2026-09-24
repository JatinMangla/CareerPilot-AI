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
  // Before email: "Referrer's email" is someone else's address, not yours.
  ["referrer", /\b(referr(er|al|ed)|who referred)\b/i],
  ["email", /\b(e-?mail)\b/i],
  // "mobile" alone also matched "Mobile development experience?" and filled in
  // a phone number; it has to be about a number.
  ["phone", /\b(phone|mobile\s*(number|no|phone)|contact\s*number|telephone|cell\s*(phone|number))\b/i],
  ["linkedin", /\blinked\s*in\b/i],
  ["github", /\b(github|git\s*hub)\b/i],
  ["portfolio", /\b(portfolio|personal\s*(site|website)|website|url|blog)\b/i],
  ["location", /\b(location|city|current\s*residence|where.*based|address)\b/i],
  // Not "tell us about" / "anything else": "Tell us about a project you built"
  // got the whole cover letter pasted in. Those go to prepared answers or to you.
  ["cover_letter", /\b(cover\s*letter|why.*(interest|apply|join|company|role)|motivation)\b/i],
  ["notice_period", /\b(notice\s*period|when.*(start|available)|availability|joining)\b/i],
  // Before salary: what you earn now is not what you are asking for.
  ["current_salary", /\b(current|present|last)\s*(salary|compensation|ctc|pay|package)\b/i],
  // Not bare "rate": "Rate your proficiency in React (1-5)" was answered with
  // your expected CTC.
  ["salary", /\b(salary|compensation|ctc|expected\s*pay|(hourly|daily|day)\s*rate|rate\s*expectations?)\b/i],
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

  // A question about a specific country only matches an answer about that
  // country. "Are you authorized to work in the US?" reduced to [authorized,
  // work] — "us" is too short to count — and matched the prepared India answer,
  // so the form got "Yes" for US work authorization.
  const labelCountries = countriesIn(raw);
  const sameCountry = (q) =>
    !labelCountries.length || labelCountries.some((c) => countriesIn(q).includes(c));
  screeningAnswers = screeningAnswers.filter((qa) => sameCountry((qa.question || "").toLowerCase()));

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

const COUNTRIES = [
  ["us", /\b(us|u\.s\.?|usa|united states|america)\b/],
  ["uk", /\b(uk|u\.k\.?|united kingdom|britain)\b/],
  ["in", /\b(india|indian)\b/],
  ["ca", /\bcanad(a|ian)\b/],
  ["eu", /\b(eu|europe|european union)\b/],
  ["sg", /\bsingapore\b/],
  ["au", /\baustralia\b/],
  ["ae", /\b(uae|dubai|emirates)\b/],
];

function countriesIn(text) {
  return COUNTRIES.filter(([, re]) => re.test(text)).map(([code]) => code);
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
    // Never guessed: someone else's email, or what you earn today.
    case "referrer":
    case "current_salary":
      return null;
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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The dropdown option that says what `want` says, or null.
 *
 * Exact text first, then an option that appears in the answer as whole words,
 * then an option that starts with the answer as a whole word. The old rules were
 * substring and three-letter prefix, which picked "1" for "12 LPA" and
 * "Indiana" for "India".
 */
export function pickOption(options, want) {
  const w = (want || "").toLowerCase().trim();
  if (!w) return null;
  const opts = (options || []).filter((o) => o.text && o.text.trim());
  const text = (o) => o.text.toLowerCase().trim();

  const exact = opts.find((o) => text(o) === w);
  if (exact) return exact;
  const inAnswer = opts
    .filter((o) => text(o).length >= 2 && new RegExp(`(^|\\W)${escapeRe(text(o))}(\\W|$)`).test(w))
    .sort((a, b) => text(b).length - text(a).length)[0];
  if (inAnswer) return inAnswer;
  if (w.length >= 3) {
    const starts = opts.find((o) => new RegExp(`^${escapeRe(w)}(\\W|$)`).test(text(o)));
    if (starts) return starts;
  }
  // A number against ranged options: "4" → "3-5 years", "7" → "5+ years".
  const n = /^\s*(\d+(?:\.\d+)?)\b/.exec(w);
  if (n) {
    const v = Number(n[1]);
    for (const o of opts) {
      const range = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/.exec(text(o));
      if (range && v >= Number(range[1]) && v <= Number(range[2])) return o;
      const plus = /(\d+(?:\.\d+)?)\s*\+/.exec(text(o));
      if (!range && plus && v >= Number(plus[1])) return o;
    }
  }
  return null;
}

export { SKIP_INTENTS };
