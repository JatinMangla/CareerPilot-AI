import { tasks } from "@/lib/prompts";
import { geminiJson, geminiStream } from "@/lib/gemini";
import { cacheKey, readCache, writeCache } from "@/lib/aiCache";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel clamps this to the plan limit

/**
 * Every AI task in the app runs through here, on Google Gemini's free tier.
 *
 * Each task declares a cost/quality tier (see lib/prompts.ts) which selects the
 * model and how much the model may think — mechanical work runs on the fast
 * model, and only text that reaches an employer runs on the strongest one.
 */
export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      {
        error:
          "No AI key configured. Add a free GEMINI_API_KEY from https://aistudio.google.com/apikey.",
      },
      { status: 500 }
    );
  }

  let body: {
    task?: string;
    input?: Record<string, any>;
    strategyAddendum?: string;
    /** Set by a "regenerate" action to bypass a cached answer. */
    fresh?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const def = body.task ? tasks[body.task] : undefined;
  if (!def) {
    return Response.json({ error: `Unknown task: ${body.task}` }, { status: 400 });
  }

  const { system, user } = def.build(body.input || {});
  const systemPrompt = body.strategyAddendum
    ? `${system}\n\n<evolved_strategy>\n${body.strategyAddendum}\n</evolved_strategy>`
    : system;
  const tier = def.tier ?? "standard";

  // Streaming errors surface inside the stream, so only JSON needs a try/catch.
  if (def.mode === "stream") {
    return new Response(
      geminiStream(systemPrompt, user, def.maxTokens ?? 32000, tier),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "x-ai-provider": "gemini",
          "x-ai-tier": tier,
        },
      }
    );
  }

  /*
   * Cached answers cost nothing, so they must NOT advertise a provider call:
   * lib/aiClient.ts bumps the free-tier counter off the x-ai-provider header, and
   * charging the user's daily quota for a response we never asked Gemini for is
   * how a guard stops being trustworthy.
   */
  const ttl = def.cacheTtl ?? 0;
  const key = ttl > 0 ? cacheKey(body.task!, body.input || {}, body.strategyAddendum) : null;

  if (key && !body.fresh) {
    const hit = await readCache(key);
    if (hit) {
      return new Response(hit, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "x-ai-cache": "hit",
          "x-ai-tier": tier,
        },
      });
    }
  }

  try {
    const json = await geminiJson(
      systemPrompt,
      user,
      def.maxTokens ?? 8000,
      def.schema!,
      tier
    );
    if (key) await writeCache(key, json, ttl);
    return new Response(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-ai-provider": "gemini",
        "x-ai-tier": tier,
        "x-ai-cache": key ? "miss" : "off",
      },
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" && err.status >= 400 ? err.status : 502;
    console.error("[ai] task failed", { task: body.task, tier, status, err: err?.message });
    return Response.json({ error: err?.message || "AI request failed" }, { status });
  }
}
