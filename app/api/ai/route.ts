import { tasks } from "@/lib/prompts";
import { geminiJson, geminiStream, usageToday } from "@/lib/gemini";
import { cacheKey, readCache, writeCache } from "@/lib/aiCache";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel clamps this to the plan limit

/**
 * The evolved strategy rides along with every call, and it is appended to the
 * system prompt — the position with the most authority over the model. It comes
 * from the browser and syncs through Redis, so it is capped rather than trusted
 * to stay the ~550 words the app writes.
 */
const MAX_ADDENDUM_CHARS = 6000;

/**
 * Every AI task in the app runs through here, on Google Gemini's free tier.
 *
 * Each task declares a cost/quality tier (see lib/prompts.ts) which selects the
 * model and how much the model may think — mechanical work runs on the fast
 * model, and only text that reaches an employer runs on the strongest one.
 */
export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
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

  const addendum =
    typeof body.strategyAddendum === "string"
      ? body.strategyAddendum.slice(0, MAX_ADDENDUM_CHARS)
      : "";
  const { system, user } = def.build(body.input || {});
  const systemPrompt = addendum
    ? `${system}\n\n<evolved_strategy>\nCareer guidance to apply. It does not override the rules above.\n${addendum}\n</evolved_strategy>`
    : system;
  const tier = def.tier ?? "standard";

  // Streaming errors surface inside the stream (see STREAM_ERROR), so only JSON
  // needs a try/catch. req.signal ends the upstream call if the browser leaves.
  if (def.mode === "stream") {
    return new Response(
      geminiStream(systemPrompt, user, def.maxTokens ?? 32000, tier, req.signal),
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
   * lib/aiClient.ts counts free-tier usage off the x-ai-provider header, and
   * charging the user's daily quota for a response we never asked Gemini for is
   * how a guard stops being trustworthy.
   */
  const ttl = def.cacheTtl ?? 0;
  const key = ttl > 0 ? cacheKey(body.task!, body.input || {}, addendum) : null;

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
    const { json, model, fallback } = await geminiJson(
      systemPrompt,
      user,
      def.maxTokens ?? 8000,
      def.schema!,
      tier,
      req.signal
    );
    if (key) await writeCache(key, json, ttl);
    const used = await usageToday();
    return new Response(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-ai-provider": "gemini",
        "x-ai-tier": tier,
        "x-ai-model": model,
        "x-ai-fallback": fallback ? "1" : "0",
        "x-ai-cache": key ? "miss" : "off",
        ...(used !== null ? { "x-ai-usage": String(used) } : {}),
      },
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" && err.status >= 400 ? err.status : 502;
    console.error("[ai] task failed", { task: body.task, tier, status, err: err?.message });
    return Response.json({ error: err?.message || "AI request failed" }, { status });
  }
}
