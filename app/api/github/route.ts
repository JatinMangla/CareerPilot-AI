export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Reads a public GitHub profile and its repositories.
 *
 * Uses GitHub's public REST API with no token — recruiters see exactly this
 * view, which is the point of the audit. Unauthenticated calls are limited to
 * 60/hour per IP, which is ample for an occasional review.
 */

const GH = "https://api.github.com";

function usernameFrom(input: string): string {
  const raw = (input || "").trim();
  const match = raw.match(/github\.com\/([^/?#]+)/i);
  return (match ? match[1] : raw).replace(/^@/, "").trim();
}

export async function POST(req: Request) {
  const { username: raw } = await req.json().catch(() => ({ username: "" }));
  const username = usernameFrom(raw);

  if (!username || !/^[A-Za-z0-9-]{1,39}$/.test(username)) {
    return Response.json(
      { error: "Enter a GitHub username or profile URL." },
      { status: 400 }
    );
  }

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CareerPilot-AI",
  };

  try {
    const profileRes = await fetch(`${GH}/users/${username}`, {
      headers,
      cache: "no-store",
    });

    if (profileRes.status === 404) {
      return Response.json({ error: `No public GitHub user "${username}".` }, { status: 404 });
    }
    if (profileRes.status === 403) {
      return Response.json(
        { error: "GitHub rate limit reached (60/hour). Try again in a little while." },
        { status: 429 }
      );
    }
    if (!profileRes.ok) {
      return Response.json(
        { error: `GitHub returned ${profileRes.status}.` },
        { status: 502 }
      );
    }

    const p = await profileRes.json();

    const reposRes = await fetch(
      `${GH}/users/${username}/repos?sort=updated&per_page=30&type=owner`,
      { headers, cache: "no-store" }
    );
    const rawRepos: any[] = reposRes.ok ? await reposRes.json() : [];

    const repos = rawRepos
      .filter((r) => !r.fork)
      .map((r) => ({
        name: r.name,
        description: r.description || "",
        language: r.language || "",
        stars: r.stargazers_count,
        topics: r.topics || [],
        homepage: r.homepage || "",
        hasDescription: !!r.description,
        hasHomepage: !!r.homepage,
        updatedAt: r.updated_at,
        url: r.html_url,
        size: r.size,
      }));

    return Response.json({
      profile: {
        login: p.login,
        name: p.name || "",
        bio: p.bio || "",
        company: p.company || "",
        location: p.location || "",
        blog: p.blog || "",
        publicRepos: p.public_repos,
        followers: p.followers,
        createdAt: p.created_at,
        avatar: p.avatar_url,
        url: p.html_url,
        hasBio: !!p.bio,
        hasBlog: !!p.blog,
      },
      repos,
      forkCount: rawRepos.filter((r) => r.fork).length,
    });
  } catch (err: any) {
    console.error("[github] fetch failed", err?.message);
    return Response.json({ error: `Could not reach GitHub: ${err?.message}` }, { status: 502 });
  }
}
