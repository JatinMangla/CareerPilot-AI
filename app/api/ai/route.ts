import Anthropic from "@anthropic-ai/sdk";
import { tasks } from "@/lib/prompts";
import { geminiText, geminiJson } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel clamps to plan limit

const MODEL = "claude-opus-4-8";

export async function POST(req: Request) {
  const provider = process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : process.env.GEMINI_API_KEY
    ? "gemini"
    : null;

  if (!provider) {
    return Response.json(
      {
        error:
          "No AI key configured. Add ANTHROPIC_API_KEY (best quality) or a free GEMINI_API_KEY from https://aistudio.google.com/apikey.",
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

  try {
    // ---------- Free fallback provider (Gemini) ----------
    if (provider === "gemini") {
      if (def.mode === "json") {
        const json = await geminiJson(systemPrompt, user, def.maxTokens ?? 8000, def.schema!);
        return new Response(json, {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      const text = await geminiText(systemPrompt, user, def.maxTokens ?? 32000);
      return new Response(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // ---------- Primary provider (Claude) ----------
    const client = new Anthropic();
    if (def.mode === "json") {
      const response = (await client.messages.create({
        model: MODEL,
        max_tokens: def.maxTokens ?? 8000,
        thinking: { type: "adaptive" },
        system: systemPrompt,
        messages: [{ role: "user", content: user }],
        output_config: {
          format: { type: "json_schema", schema: def.schema },
        },
      } as Anthropic.MessageCreateParamsNonStreaming)) as Anthropic.Message;

      const text = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === "text"
      )?.text;
      if (!text) {
        return Response.json({ error: "Empty AI response" }, { status: 502 });
      }
      return new Response(text, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // stream mode — plain text chunks
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: def.maxTokens ?? 32000,
      thinking: { type: "adaptive" },
      system: systemPrompt,
      messages: [{ role: "user", content: user }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (err: any) {
          controller.enqueue(
            encoder.encode(`\n\n[AI stream error: ${err?.message || "unknown"}]`)
          );
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    const msg =
      status === 401
        ? "Invalid Anthropic API key."
        : status === 429
        ? "Rate limited by the AI API — wait a moment and retry."
        : err?.message || "AI request failed";
    return Response.json({ error: msg }, { status: status >= 400 ? status : 500 });
  }
}
