export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fetches real job listings from Adzuna if ADZUNA_APP_ID / ADZUNA_APP_KEY are set.
 * Otherwise returns { available: false } and the client falls back to
 * AI-researched leads via /api/ai (task: find_jobs).
 */
export async function POST(req: Request) {
  const { query, location } = await req.json().catch(() => ({ query: "", location: "" }));

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    return Response.json({ available: false, listings: [] });
  }

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: "10",
    what: query || "react frontend developer",
  });
  if (location && location.trim().toLowerCase() !== "india") {
    params.set("where", location.trim());
  }

  try {
    const res = await fetch(
      `https://api.adzuna.com/v1/api/jobs/in/search/1?${params.toString()}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return Response.json({ available: false, listings: [], error: `Adzuna ${res.status}` });
    }
    const data = await res.json();
    const listings = (data.results || []).map((r: any) => ({
      id: String(r.id),
      title: r.title,
      company: r.company?.display_name || "Unknown",
      location: r.location?.display_name || "",
      salary:
        r.salary_min || r.salary_max
          ? `₹${Math.round((r.salary_min || 0) / 100000)}-${Math.round((r.salary_max || 0) / 100000)} LPA (listed)`
          : "",
      url: r.redirect_url,
      description: r.description,
    }));
    return Response.json({ available: true, listings });
  } catch (err: any) {
    return Response.json({ available: false, listings: [], error: err?.message });
  }
}
