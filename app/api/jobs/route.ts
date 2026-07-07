export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Live job listings, in priority order:
 *   1. OpenWeb Ninja JSearch (Google for Jobs data: LinkedIn/Indeed/Glassdoor etc.)
 *   2. Adzuna
 * Returns { available: false } if neither is configured/working —
 * the client then falls back to AI-researched leads.
 */

interface Listing {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  url: string;
  description: string;
  source: string;
}

export async function POST(req: Request) {
  const { query, location } = await req.json().catch(() => ({ query: "", location: "" }));
  const q = (query || "react frontend developer").trim();
  const loc = (location || "India").trim();

  // ---------- 1. OpenWeb Ninja JSearch ----------
  const owKey = process.env.OPENWEBNINJA_API_KEY;
  if (owKey) {
    try {
      const url = `https://api.openwebninja.com/jsearch/search-v2?query=${encodeURIComponent(
        `${q} jobs in ${loc}`
      )}`;
      const res = await fetch(url, {
        headers: { "X-API-Key": owKey },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const jobs: any[] = data?.data?.jobs || [];
        if (jobs.length > 0) {
          const listings: Listing[] = jobs.slice(0, 10).map((j) => ({
            id: String(j.job_id || `${j.employer_name}-${j.job_title}`).slice(0, 80),
            title: j.job_title || "Unknown role",
            company: j.employer_name || "Unknown",
            location:
              j.job_location || [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "),
            salary:
              j.job_salary_string ||
              (j.job_min_salary && j.job_max_salary
                ? `${j.job_min_salary}-${j.job_max_salary} ${j.job_salary_period || ""}`.trim()
                : ""),
            url: j.job_apply_link || j.job_google_link || "",
            description: String(j.job_description || "").slice(0, 1200),
            source: "jsearch",
          }));
          return Response.json({ available: true, source: "jsearch", listings });
        }
      }
    } catch {
      // fall through to Adzuna
    }
  }

  // ---------- 2. Adzuna ----------
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (appId && appKey) {
    try {
      const params = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        results_per_page: "10",
        what: q,
      });
      if (loc && loc.toLowerCase() !== "india") params.set("where", loc);
      const res = await fetch(
        `https://api.adzuna.com/v1/api/jobs/in/search/1?${params.toString()}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        const listings: Listing[] = (data.results || []).map((r: any) => ({
          id: String(r.id),
          title: r.title,
          company: r.company?.display_name || "Unknown",
          location: r.location?.display_name || "",
          salary:
            r.salary_min || r.salary_max
              ? `₹${Math.round((r.salary_min || 0) / 100000)}-${Math.round((r.salary_max || 0) / 100000)} LPA (listed)`
              : "",
          url: r.redirect_url,
          description: String(r.description || "").slice(0, 1200),
          source: "adzuna",
        }));
        if (listings.length > 0) {
          return Response.json({ available: true, source: "adzuna", listings });
        }
      }
    } catch {
      // fall through
    }
  }

  return Response.json({ available: false, listings: [] });
}
