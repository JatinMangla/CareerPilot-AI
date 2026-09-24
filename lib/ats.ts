/**
 * ATS (Applicant Tracking System) detection + automation policy.
 *
 * Nothing in this app submits an application any more — the last step is always
 * a human clicking Submit in a tab that has been opened and filled for them.
 * The two flags below survived that change because they still describe real
 * differences between forms:
 *
 *   autoFill    — the assistant can recognize and fill this form's fields.
 *   autoSubmit  — the form is a single standard page that will be COMPLETELY
 *                 filled, so the tab you're handed needs a read and one click.
 *                 A false here (Workday's wizard, a portal) means there is real
 *                 work left for you on the page.
 *
 * Social job portals (LinkedIn, Naukri, Indeed…) forbid automated interaction
 * in their terms and ban accounts for it, so the agent never opens or touches
 * them at all — we hand you a prepared kit + direct link instead.
 */

export type AtsKind =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "recruitee"
  | "workday"
  | "workatastartup"
  | "ycombinator"
  | "portal"
  | "unknown";

export interface AtsInfo {
  kind: AtsKind;
  label: string;
  /** Standard single-page form the assistant can fill completely. */
  autoSubmit: boolean;
  /** Can the agent at least auto-fill it for you to review? */
  autoFill: boolean;
  note: string;
}

const PORTALS = [
  "linkedin.",
  "naukri.",
  "indeed.",
  "glassdoor.",
  "monster.",
  "shine.",
  "foundit.",
  "timesjobs.",
  "wellfound.",
  "angel.co",
  "instahyre.",
  "cutshort.",
  "hirist.",
];

/**
 * Sources whose listings came from a real job board or API.
 *
 * `find_jobs` asks the model to invent "currently-plausible" openings, including
 * their URLs — which is fine as a research lead, but those URLs must never reach
 * the apply pipeline. A fabricated greenhouse.io link is indistinguishable from a
 * real one to detectAts, and would have you tailoring a resume for a job that
 * does not exist.
 */
const VERIFIED_SOURCES = new Set([
  "company-boards",
  "yc-boards",
  "jsearch",
  "adzuna",
]);

export function isVerifiedSource(source: string | undefined): boolean {
  return !!source && VERIFIED_SOURCES.has(source);
}

/**
 * Matching is by hostname, not substring. Substrings mislabelled links:
 * "lever.co" matched clever.com, "shine." matched moonshine.com, and "workday"
 * matched any URL containing the word.
 */
function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** host is `domain` or a subdomain of it. */
const onDomain = (host: string, domain: string) => host === domain || host.endsWith("." + domain);

/** A portal label ("linkedin.", "angel.co") as a whole part of the hostname. */
function isPortalHost(host: string): boolean {
  const labels = host.split(".");
  return PORTALS.some((p) => {
    const parts = p.replace(/\.$/, "").split(".");
    // every part of the portal name appears as consecutive labels of the host
    return labels.some((_, i) => parts.every((part, j) => labels[i + j] === part));
  });
}

export function detectAts(rawUrl: string): AtsInfo {
  const url = (rawUrl || "").toLowerCase();
  const host = hostOf(rawUrl);

  if (isPortalHost(host)) {
    return {
      kind: "portal",
      label: "Job portal",
      autoSubmit: false,
      autoFill: false,
      note: "Portal terms forbid automation (account-ban risk). Use the prepared kit and apply by hand — it takes ~60 seconds.",
    };
  }

  // gh_jid: a Greenhouse form embedded in the company's own careers page.
  if (onDomain(host, "greenhouse.io") || onDomain(host, "grnh.se") || /[?&]gh_jid=/.test(url))
    return {
      kind: "greenhouse",
      label: "Greenhouse",
      autoSubmit: true,
      autoFill: true,
      note: "Standard single-page form — filled completely; read it and press Submit.",
    };

  if (onDomain(host, "lever.co"))
    return {
      kind: "lever",
      label: "Lever",
      autoSubmit: true,
      autoFill: true,
      note: "Standard single-page form — filled completely; read it and press Submit.",
    };

  if (onDomain(host, "workatastartup.com"))
    return {
      kind: "workatastartup",
      label: "YC · Work at a Startup",
      autoSubmit: false,
      autoFill: true,
      note: "YC's own board needs a signed-in account and sends a personal message to the founder — the agent fills what it can, you review and send.",
    };

  if (onDomain(host, "ycombinator.com"))
    return {
      kind: "ycombinator",
      label: "Y Combinator",
      autoSubmit: false,
      autoFill: true,
      note: "YC listings usually hand off to the company's own ATS (Ashby/Greenhouse/Lever) — open it and the real application URL is a standard ATS form.",
    };

  if (onDomain(host, "ashbyhq.com"))
    return {
      kind: "ashby",
      label: "Ashby",
      autoSubmit: true,
      autoFill: true,
      note: "Standard single-page form — filled completely; read it and press Submit.",
    };

  if (onDomain(host, "workable.com"))
    return {
      kind: "workable",
      label: "Workable",
      autoSubmit: true,
      autoFill: true,
      note: "Standard single-page form — filled completely; read it and press Submit.",
    };

  if (onDomain(host, "smartrecruiters.com"))
    return {
      kind: "smartrecruiters",
      label: "SmartRecruiters",
      autoSubmit: false,
      autoFill: true,
      note: "Auto-fills; submit yourself after review (layout varies by company).",
    };

  if (onDomain(host, "recruitee.com"))
    return {
      kind: "recruitee",
      label: "Recruitee",
      autoSubmit: false,
      autoFill: true,
      note: "Auto-fills; submit yourself after review.",
    };

  if (onDomain(host, "myworkdayjobs.com") || onDomain(host, "workday.com"))
    return {
      kind: "workday",
      label: "Workday",
      autoSubmit: false,
      autoFill: true,
      note: "Multi-step and account-gated — the agent fills what it can, you finish the wizard.",
    };

  return {
    kind: "unknown",
    label: "Company site",
    autoSubmit: false,
    autoFill: true,
    note: "Unrecognized form — the agent opens it and fills any fields it recognizes for your review.",
  };
}

export function atsBadgeTone(info: AtsInfo): "green" | "amber" | "red" {
  if (info.autoSubmit) return "green";
  if (info.autoFill) return "amber";
  return "red";
}
