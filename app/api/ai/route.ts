import Anthropic from "@anthropic-ai/sdk";
import { tasks } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel clamps to plan limit

const MODEL = "claude-opus-4-8";

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example)." },
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

  const client = new Anthropic();
  const { system, user } = def.build(body.input || {});
  const systemPrompt = body.strategyAddendum
    ? `${system}\n\n<evolved_strategy>\n${body.strategyAddendum}\n</evolved_strategy>`
    : system;

  try {
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
