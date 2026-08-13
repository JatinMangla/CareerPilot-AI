import Anthropic from "@anthropic-ai/sdk";
import { tasks, TIERS } from "@/lib/prompts";
import { geminiText, geminiJson } from "@/lib/gemini";
import { getSpend, recordSpend } from "@/lib/spend";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel clamps to plan limit

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
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "x-ai-provider": "gemini",
          },
        });
      }
      const text = await geminiText(systemPrompt, user, def.maxTokens ?? 32000);
      return new Response(text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "x-ai-provider": "gemini",
        },
      });
    }

    // ---------- Primary provider (Claude) ----------
    // Hard stop before spending anything more today.
    const spend = await getSpend();
    if (spend.exceeded) {
      return Response.json(
        {
          error:
            `Daily AI budget reached ($${spend.spentUsd.toFixed(2)} of $${spend.limitUsd.toFixed(2)} across ${spend.calls} calls). ` +
            `It resets at midnight UTC. Raise AI_DAILY_USD_LIMIT if you need more today.`,
        },
        { status: 429 }
      );
    }

    const { model, effort } = TIERS[def.tier ?? "standard"];
    const client = new Anthropic();

    if (def.mode === "json") {
      const response = (await client.messages.create({
        model,
        max_tokens: def.maxTokens ?? 8000,
        thinking: { type: "adaptive" },
        output_config: {
          effort,
          format: { type: "json_schema", schema: def.schema },
        },
        system: systemPrompt,
        messages: [{ role: "user", content: user }],
      } as Anthropic.MessageCreateParamsNonStreaming)) as Anthropic.Message;

      await recordSpend(
        model,
        response.usage?.input_tokens ?? 0,
        response.usage?.output_tokens ?? 0
      );

      const text = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === "text"
      )?.text;
      if (!text) {
        console.error("[ai] empty response", { task: body.task, model });
        return Response.json({ error: "Empty AI response" }, { status: 502 });
      }
      return new Response(text, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "x-ai-provider": "anthropic",
          "x-ai-model": model,
        },
      });
    }

    // stream mode — plain text chunks
    const stream = client.messages.stream({
      model,
      max_tokens: def.maxTokens ?? 32000,
      thinking: { type: "adaptive" },
      output_config: { effort },
      system: systemPrompt,
      messages: [{ role: "user", content: user }],
    } as Anthropic.MessageStreamParams);

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
          // Usage is only final once the stream completes.
          const final = await stream.finalMessage();
          await recordSpend(
            model,
            final.usage?.input_tokens ?? 0,
            final.usage?.output_tokens ?? 0
          );
        } catch (err: any) {
          console.error("[ai] stream failed", { task: body.task, model, err: err?.message });
          controller.enqueue(
            encoder.encode(`\n\n[AI stream error: ${err?.message || "unknown"}]`)
          );
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "x-ai-provider": "anthropic",
        "x-ai-model": model,
      },
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
