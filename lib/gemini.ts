/**
 * Google Gemini provider — the only AI provider in this app.
 *
 * Reliability first. The free tier's newest models are heavily contended: at the
 * time of writing gemini-3.7-flash answered 0 of 3 requests (503 "experiencing
 * high demand", then 429), which took every "deep" task down with it. So each
 * tier is a CHAIN of models: on an overload or quota error we walk to the next
 * one instead of surfacing a failure. Quality steps down; the feature still works.
 *
 * Also fixed here, because the first version got them wrong:
 *  - streaming genuinely streams (SSE) rather than blocking then dumping
 *  - JSON tasks enforce `responseSchema` instead of asking nicely in the prompt
 *  - thinking is bounded, so reasoning cannot consume the whole output budget
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type Tier = "fast" | "standard" | "deep";

interface ModelSpec {
  id: string;
  /** 2.5-era models reject `thinkingLevel` outright (400 INVALID_ARGUMENT). */
  thinkingLevel: boolean;
}

/**
 * Ordered fallback chains, verified against the live free tier.
 *   fast     — classification, judging, short interview turns
 *   standard — most work
 *   deep     — text that reaches an employer
 */
const CHAINS: Record<Tier, { thinking: "low" | "high"; models: ModelSpec[] }> = {
  fast: {
    thinking: "low",
    models: [
      { id: "gemini-3.5-flash-lite", thinkingLevel: true },
      { id: "gemini-2.5-flash", thinkingLevel: false },
    ],
  },
  standard: {
    thinking: "low",
    models: [
      { id: "gemini-3.5-flash", thinkingLevel: true },
      { id: "gemini-3.6-flash", thinkingLevel: true },
      { id: "gemini-2.5-flash", thinkingLevel: false },
    ],
  },
  deep: {
    thinking: "high",
    models: [
      { id: "gemini-3.6-flash", thinkingLevel: true },
      { id: "gemini-3.5-flash", thinkingLevel: true },
      { id: "gemini-2.5-flash", thinkingLevel: false },
    ],
  },
};

function chainFor(tier: Tier = "standard") {
  const c = CHAINS[tier] ?? CHAINS.standard;
  const override = process.env.GEMINI_MODEL;
  if (override) {
    return { thinking: c.thinking, models: [{ id: override, thinkingLevel: true }] };
  }
  return c;
}

/**
 * Gemini's responseSchema is an OpenAPI subset — it rejects JSON Schema keywords
 * like `additionalProperties`. Strip what it will not accept.
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

function requestBody(
  spec: ModelSpec,
  system: string,
  user: string,
  maxTokens: number,
  thinking: "low" | "high",
  schema?: Record<string, any>
) {
  const generationConfig: Record<string, any> = { maxOutputTokens: maxTokens };
  // Thinking tokens count against maxOutputTokens; leaving this unbounded is how
  // the old build returned empty candidates with finishReason MAX_TOKENS.
  if (spec.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  if (schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(schema);
  }
  return JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig,
  });
}

/** Overload / quota conditions worth retrying or falling back from. */
function isTransient(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiError(status: number, body: string): Error {
  if (status === 429) {
    return Object.assign(
      new Error(
        "Every available AI model is rate-limited right now. The free tier resets daily — try again in a few minutes."
      ),
      { status }
    );
  }
  if (status === 400 && /API key/i.test(body)) {
    return Object.assign(new Error("Invalid GEMINI_API_KEY."), { status });
  }
  return Object.assign(new Error(`Gemini error ${status}: ${body.slice(0, 300)}`), { status });
}

type CallResult =
  | { ok: true; data: any }
  | { ok: false; status: number; body: string };

/** Calls one model, retrying transient failures before giving up on it. */
async function callModel(
  spec: ModelSpec,
  payload: string,
  key: string,
  attempts = 2
): Promise<CallResult> {
  let last: CallResult = { ok: false, status: 0, body: "" };
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${BASE}/${spec.id}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    if (res.ok) return { ok: true, data: await res.json() };

    const body = await res.text().catch(() => "");
    last = { ok: false, status: res.status, body };
    if (!isTransient(res.status)) break; // a real error — don't spend the chain on it
    if (i < attempts) await sleep(600 * i);
  }
  return last;
}

async function generate(
  system: string,
  user: string,
  maxTokens: number,
  tier: Tier,
  schema?: Record<string, any>
): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const { models, thinking } = chainFor(tier);
  let lastStatus = 0;
  let lastBody = "";

  for (const spec of models) {
    const payload = requestBody(spec, system, user, maxTokens, thinking, schema);
    const result = await callModel(spec, payload, key);

    if (!result.ok) {
      lastStatus = result.status;
      lastBody = result.body;
      if (isTransient(result.status)) {
        console.error("[gemini] model unavailable, falling back", {
          model: spec.id,
          status: result.status,
        });
        continue;
      }
      throw apiError(result.status, result.body);
    }

    const cand = result.data?.candidates?.[0];
    const text: string =
      cand?.content?.parts?.map((p: any) => p.text || "").join("") || "";
    if (text) return text;

    // Empty candidate: usually the output budget was consumed by thinking, or a
    // safety block. Both are worth one attempt on the next model down.
    const reason = cand?.finishReason || result.data?.promptFeedback?.blockReason || "unknown";
    console.error("[gemini] empty response, falling back", { model: spec.id, reason });
    lastStatus = 502;
    lastBody = `empty response (${reason})`;
  }

  throw apiError(lastStatus || 502, lastBody || "no model returned a response");
}

export async function geminiText(
  system: string,
  user: string,
  maxTokens: number,
  tier: Tier = "standard"
): Promise<string> {
  return generate(system, user, maxTokens, tier);
}

/** Schema-enforced JSON. Throws only once every model in the chain has failed. */
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
 * Token-by-token streaming over SSE, with the same model fallback: if the first
 * model is overloaded we switch before anything has been emitted.
 */
export function geminiStream(
  system: string,
  user: string,
  maxTokens: number,
  tier: Tier = "standard"
): ReadableStream<Uint8Array> {
  const key = process.env.GEMINI_API_KEY!;
  const { models, thinking } = chainFor(tier);
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let emitted = false;
      let lastStatus = 0;

      for (const spec of models) {
        if (emitted) break;
        try {
          const res = await fetch(`${BASE}/${spec.id}:streamGenerateContent?alt=sse&key=${key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody(spec, system, user, maxTokens, thinking),
          });

          if (!res.ok || !res.body) {
            lastStatus = res.status;
            if (isTransient(res.status)) {
              console.error("[gemini] stream model unavailable, falling back", {
                model: spec.id,
                status: res.status,
              });
              continue;
            }
            throw apiError(res.status, await res.text().catch(() => ""));
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop() ?? "";

            for (const frame of frames) {
              const line = frame.split(/\r?\n/).find((l) => l.startsWith("data:"));
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
          if (emitted) break;
        } catch (err: any) {
          console.error("[gemini] stream failed", { model: spec.id, err: err?.message });
          if (!emitted) {
            controller.enqueue(encoder.encode(`\n\n[AI error: ${err?.message || "unknown"}]`));
            controller.close();
            return;
          }
        }
      }

      if (!emitted) {
        controller.enqueue(
          encoder.encode(
            lastStatus === 429
              ? "[Every AI model is rate-limited right now — the free tier resets daily. Try again shortly.]"
              : "[Every AI model is busy right now. Please try again in a moment.]"
          )
        );
      }
      controller.close();
    },
  });
}
