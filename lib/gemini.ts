/**
 * Google Gemini provider — the only AI provider in this app.
 *
 * Three things this module gets right that the first version didn't:
 *  1. Streaming actually streams (SSE), instead of blocking and dumping.
 *  2. JSON tasks enforce the schema via `responseSchema`, not by asking nicely
 *     in the prompt — so a malformed response can't reach a `.map()` in the UI.
 *  3. Thinking is bounded per tier, so reasoning can't eat the whole output
 *     budget and return an empty candidate.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type Tier = "fast" | "standard" | "deep";

/**
 * Free-tier models, verified against the live API. Pro models return 429 on the
 * free tier, so the Flash family is the whole menu.
 *   fast     — classification, judging, short interview turns
 *   standard — most work
 *   deep     — text that goes in front of an employer
 */
const TIER_MODELS: Record<Tier, { model: string; thinking: "off" | "low" | "high" }> = {
  fast: { model: "gemini-3.5-flash-lite", thinking: "off" },
  standard: { model: "gemini-3.6-flash", thinking: "low" },
  deep: { model: "gemini-3.7-flash", thinking: "high" },
};

function resolve(tier: Tier = "standard") {
  const override = process.env.GEMINI_MODEL;
  const t = TIER_MODELS[tier] ?? TIER_MODELS.standard;
  return { model: override || t.model, thinking: t.thinking };
}

/**
 * Gemini's responseSchema is an OpenAPI subset — it rejects JSON Schema keywords
 * like `additionalProperties`. Strip what it doesn't accept.
 */
function toGeminiSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "additionalProperties" || k === "$schema") continue;
    if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, any>).map(([pk, pv]) => [pk, toGeminiSchema(pv)])
      );
    } else if (k === "items") {
      out.items = toGeminiSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function generationConfig(
  maxTokens: number,
  thinking: "off" | "low" | "high",
  schema?: Record<string, any>
) {
  const cfg: Record<string, any> = {
    maxOutputTokens: maxTokens,
    // Thinking tokens count against maxOutputTokens; unbounded reasoning is how
    // the old build produced empty responses with finishReason MAX_TOKENS.
    thinkingConfig: { thinkingLevel: thinking === "off" ? "low" : thinking },
  };
  if (schema) {
    cfg.responseMimeType = "application/json";
    cfg.responseSchema = toGeminiSchema(schema);
  }
  return cfg;
}

function requestBody(
  system: string,
  user: string,
  maxTokens: number,
  thinking: "off" | "low" | "high",
  schema?: Record<string, any>
) {
  return JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: generationConfig(maxTokens, thinking, schema),
  });
}

/** Transient upstream conditions worth one more shot. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiError(status: number, body: string): Error {
  if (status === 429) {
    return Object.assign(
      new Error(
        "Gemini free-tier limit reached — it resets daily. Wait a minute and retry, or try again tomorrow."
      ),
      { status }
    );
  }
  if (status === 400 && /API key/i.test(body)) {
    return Object.assign(new Error("Invalid GEMINI_API_KEY."), { status });
  }
  return Object.assign(new Error(`Gemini error ${status}: ${body.slice(0, 300)}`), { status });
}

/** Non-streaming call, used for JSON tasks. */
async function generate(
  system: string,
  user: string,
  maxTokens: number,
  tier: Tier,
  schema?: Record<string, any>
): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const { model, thinking } = resolve(tier);
  const payload = requestBody(system, user, maxTokens, thinking, schema);

  // Gemini returns transient 503s under load; without a retry those surfaced to
  // the user as a hard failure mid-task.
  let res!: Response;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(`${BASE}/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    if (res.ok) break;
    if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) {
      const body = await res.text().catch(() => "");
      console.error("[gemini] request failed", { model, status: res.status, attempt });
      throw apiError(res.status, body);
    }
    const backoff = 700 * 2 ** (attempt - 1);
    console.error("[gemini] retrying", { model, status: res.status, attempt, backoff });
    await sleep(backoff);
  }

  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text: string =
    cand?.content?.parts?.map((p: any) => p.text || "").join("") || "";

  if (!text) {
    const reason = cand?.finishReason || data?.promptFeedback?.blockReason || "unknown";
    console.error("[gemini] empty response", { model, reason });
    throw new Error(
      reason === "MAX_TOKENS"
        ? "Gemini ran out of output budget before answering. Try a shorter input."
        : `Gemini returned no text (${reason}).`
    );
  }
  return text;
}

export async function geminiText(
  system: string,
  user: string,
  maxTokens: number,
  tier: Tier = "standard"
): Promise<string> {
  return generate(system, user, maxTokens, tier);
}

/** Schema-enforced JSON. Throws if the model still returns something unparseable. */
export async function geminiJson(
  system: string,
  user: string,
  maxTokens: number,
  schema: Record<string, any>,
  tier: Tier = "standard"
): Promise<string> {
  const raw = await generate(system, user, maxTokens, tier, schema);
  const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    JSON.parse(candidate);
  } catch {
    console.error("[gemini] unparseable JSON", { preview: candidate.slice(0, 200) });
    throw new Error("The AI returned malformed data. Try again.");
  }
  return candidate;
}

/**
 * Real token-by-token streaming over SSE.
 * Returns a ReadableStream of plain text for the browser to append as it lands.
 */
export function geminiStream(
  system: string,
  user: string,
  maxTokens: number,
  tier: Tier = "standard"
): ReadableStream<Uint8Array> {
  const key = process.env.GEMINI_API_KEY!;
  const { model, thinking } = resolve(tier);
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(
          `${BASE}/${model}:streamGenerateContent?alt=sse&key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody(system, user, maxTokens, thinking),
          }
        );

        if (!res.ok || !res.body) {
          const body = await res.text().catch(() => "");
          throw apiError(res.status, body);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let emitted = false;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line.
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame
              .split(/\r?\n/)
              .find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const chunk =
                json?.candidates?.[0]?.content?.parts
                  ?.map((p: any) => p.text || "")
                  .join("") || "";
              if (chunk) {
                emitted = true;
                controller.enqueue(encoder.encode(chunk));
              }
            } catch {
              /* partial frame — the next read completes it */
            }
          }
        }

        if (!emitted) {
          controller.enqueue(
            encoder.encode("[The AI returned nothing. Try again, or shorten your input.]")
          );
        }
      } catch (err: any) {
        console.error("[gemini] stream failed", { err: err?.message });
        controller.enqueue(encoder.encode(`\n\n[AI error: ${err?.message || "unknown"}]`));
      }
      controller.close();
    },
  });
}
