/**
 * ATS (Applicant Tracking System) detection + automation policy.
 *
 * Official company career pages run on a handful of ATS platforms whose
 * application forms are standard and safe to automate — you're filling your own
 * application on the employer's own site.
 *
 * Social job portals (LinkedIn, Naukri, Indeed…) explicitly forbid automated
 * submission in their terms and ban accounts that do it, so they are never
 * auto-submitted — we hand you a prepared kit + direct link instead.
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
  /** Can the local agent fill AND submit this automatically? */
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
 * the submit agent. A fabricated greenhouse.io link looks auto-submittable to
 * detectAts and would have an application sent to it.
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

export function detectAts(rawUrl: string): AtsInfo {
  const url = (rawUrl || "").toLowerCase();

  if (PORTALS.some((p) => url.includes(p))) {
    return {
      kind: "portal",
      label: "Job portal",
      autoSubmit: false,
      autoFill: false,
      note: "Portal terms forbid automated submission (account-ban risk). Use the prepared kit and submit manually — it takes ~60 seconds.",
    };
  }

  if (url.includes("greenhouse.io") || url.includes("grnh.se"))
    return {
      kind: "greenhouse",
      label: "Greenhouse",
      autoSubmit: true,
      autoFill: true,
      note: "Standard form — fully automatable.",
    };

  if (url.includes("lever.co"))
    return {
      kind: "lever",
      label: "Lever",
      autoSubmit: true,
      autoFill: true,
      note: "Standard form — fully automatable.",
    };

  if (url.includes("workatastartup.com"))
    return {
      kind: "workatastartup",
      label: "YC · Work at a Startup",
      autoSubmit: false,
      autoFill: true,
      note: "YC's own board needs a signed-in account and sends a personal message to the founder — the agent fills what it can, you review and send.",
    };

  if (url.includes("ycombinator.com"))
    return {
      kind: "ycombinator",
      label: "Y Combinator",
      autoSubmit: false,
      autoFill: true,
      note: "YC listings usually hand off to the company's own ATS (Ashby/Greenhouse/Lever) — open it and the real application URL is auto-submittable.",
    };

  if (url.includes("ashbyhq.com"))
    return {
      kind: "ashby",
      label: "Ashby",
      autoSubmit: true,
      autoFill: true,
      note: "Standard form — fully automatable.",
    };

  if (url.includes("workable.com") || url.includes("apply.workable"))
    return {
      kind: "workable",
      label: "Workable",
      autoSubmit: true,
      autoFill: true,
      note: "Standard form — fully automatable.",
    };

  if (url.includes("smartrecruiters.com"))
    return {
      kind: "smartrecruiters",
      label: "SmartRecruiters",
      autoSubmit: false,
      autoFill: true,
      note: "Auto-fills; submit yourself after review (layout varies by company).",
    };

  if (url.includes("recruitee.com"))
    return {
      kind: "recruitee",
      label: "Recruitee",
      autoSubmit: false,
      autoFill: true,
      note: "Auto-fills; submit yourself after review.",
    };

  if (url.includes("myworkdayjobs.com") || url.includes("workday"))
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
