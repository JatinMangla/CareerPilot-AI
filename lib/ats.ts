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
