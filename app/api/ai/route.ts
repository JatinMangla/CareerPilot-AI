import { tasks } from "@/lib/prompts";
import { geminiJson, geminiStream } from "@/lib/gemini";

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

  let body: { task?: string; input?: Record<string, any>; strategyAddendum?: string };
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

  try {
    const json = await geminiJson(
      systemPrompt,
      user,
      def.maxTokens ?? 8000,
      def.schema!,
      tier
    );
    return new Response(json, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-ai-provider": "gemini",
        "x-ai-tier": tier,
      },
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" && err.status >= 400 ? err.status : 502;
    console.error("[ai] task failed", { task: body.task, tier, status, err: err?.message });
    return Response.json({ error: err?.message || "AI request failed" }, { status });
  }
}
