"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AutoPilot from "@/components/apply/AutoPilot";
import ApplyKits from "@/components/apply/ApplyKits";

/**
 * One place to apply from. Auto-Pilot and Apply Kits used to be separate pages
 * with separate nav entries, so it was never clear which to use for a job.
 * They stay two flows because they do different work:
 *   - Auto-Pilot tailors the resume per job (with an approval gate for any new
 *     claim) and only takes verified listings — for company ATS boards.
 *   - Apply Kits writes a cover letter and screening answers for any job,
 *     portals included, on a cheaper AI tier.
 * The tab lives in the URL (?tab=pilot|kits), so links and refreshes land on
 * the right one; /autopilot and /auto-apply redirect here.
 */
const TABS = [
  {
    key: "pilot",
    label: "🤖 Auto-Pilot",
    hint: "Tailored resume per job, you approve every new claim, then open each in a tab. Company boards only.",
  },
  {
    key: "kits",
    label: "➤ Apply Kits",
    hint: "Cover letter + screening answers for any job, portals included. Faster and cheaper.",
  },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function ApplyTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: TabKey = params.get("tab") === "kits" ? "kits" : "pilot";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Apply</h1>
        <p className="muted mt-1">
          Prepare applications for the jobs you picked, then open each one to submit it
          yourself. Nothing is ever submitted for you.
        </p>
      </div>

      <div role="tablist" aria-label="Apply mode" className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            title={t.hint}
            onClick={() => router.replace(`${pathname}?tab=${t.key}`, { scroll: false })}
            className={`rounded-xl px-4 py-2 text-sm font-semibold border transition ${
              tab === t.key
                ? "bg-neon-500/15 text-neon-400 border-neon-500/40"
                : "bg-ink-850 text-ink-400 border-ink-700 hover:text-ink-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-400 -mt-3">{TABS.find((t) => t.key === tab)!.hint}</p>

      <div role="tabpanel">{tab === "pilot" ? <AutoPilot /> : <ApplyKits />}</div>
    </div>
  );
}

export default function ApplyPage() {
  // useSearchParams needs a Suspense boundary for the static prerender.
  return (
    <Suspense fallback={null}>
      <ApplyTabs />
    </Suspense>
  );
}
