/**
 * Google Gemini provider — the only AI provider in this app.
 *
 * Reliability first. The free tier's newest models are heavily contended: at the
 * time of writing gemini-3.7-flash answered 0 of 3 requests (503 "experiencing
 * high demand", then 429), which took every "deep" task down with it. So each
 * tier is a CHAIN of models: on an overload or quota error we walk to the next
 * one instead of surfacing a failure. Quality steps down; the feature still works
 * — and the caller is told which model answered, so a step down is never silent.
 *
 * Also fixed here, because earlier versions got them wrong:
 *  - streaming genuinely streams (SSE) rather than blocking then dumping
 *  - JSON tasks enforce `responseSchema` instead of asking nicely in the prompt
 *  - thinking is bounded, so reasoning cannot consume the whole output budget
 *  - a stream that stops early (token limit, safety block, dropped connection)
 *    says so, instead of ending as if the text were complete
 *  - every call has a timeout, and stops when the browser that asked goes away
 *  - the key travels in a header, not the URL, where proxies and logs keep it
 */

import { getString, incrWithExpiry, kvConfigured } from "./kv";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** One model call may not take longer than this. The route's maxDuration is 300s. */
const CALL_TIMEOUT_MS = 90_000;

export type Tier = "fast" | "standard" | "deep";

interface ModelSpec {
  id: string;
  /**
   * Not every model accepts `thinkingLevel` — the 2.5 era rejected it outright with
   * 400 INVALID_ARGUMENT. Nothing in the chains below is 2.5-era any more, but the
   * flag stays: it is the only safe way to pin an older model back into a chain.
   */
  thinkingLevel: boolean;
}

/**
 * Ordered fallback chains, verified against the live free tier.
 *   fast     — classification, judging, short interview turns
 *   standard — most work
 *   deep     — text that reaches an employer
 *
 * The terminal link used to be gemini-2.5-flash. It is now retired: it still appears
 * in ListModels, but generateContent answers 404 "no longer available to new users",
 * so a fresh API key cannot reach it. That made every chain end in a non-transient
 * error the moment the newer models were contended — the exact case the chain exists
 * to survive. gemini-3.1-flash-lite replaces it: stable, not preview, and the least
 * contended tier, so it is the one most likely to answer when the others will not.
 */
const CHAINS: Record<Tier, { thinking: "low" | "high"; models: ModelSpec[] }> = {
  fast: {
    thinking: "low",
    models: [
      { id: "gemini-3.5-flash-lite", thinkingLevel: true },
      { id: "gemini-3.1-flash-lite", thinkingLevel: true },
    ],
  },
  standard: {
    thinking: "low",
    models: [
      { id: "gemini-3.5-flash", thinkingLevel: true },
      { id: "gemini-3.6-flash", thinkingLevel: true },
      { id: "gemini-3.1-flash-lite", thinkingLevel: true },
    ],
  },
  deep: {
    thinking: "high",
    models: [
      { id: "gemini-3.6-flash", thinkingLevel: true },
      { id: "gemini-3.5-flash", thinkingLevel: true },
      { id: "gemini-3.1-flash-lite", thinkingLevel: true },
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

/* ---------- usage counting ---------- */

/** Gemini's free-tier daily quotas reset at midnight Pacific time, not local time. */
export function pacificDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
}

const usageKey = () => `cp:usage:gemini:${pacificDay()}`;

/**
 * Counts every request actually sent to Gemini — fallbacks and retries included,
 * which the old per-device, per-click counter could not see. Fails open.
 */
async function countCall(): Promise<void> {
  if (!kvConfigured()) return;
  try {
    await incrWithExpiry(usageKey(), 60 * 60 * 48);
  } catch {
    /* counting must never break a call */
  }
}

/** Today's count, for the response header. Null when there is no Redis to ask. */
export async function usageToday(): Promise<number | null> {
  if (!kvConfigured()) return null;
  try {
    return Number(await getString(usageKey())) || 0;
  } catch {
    return null;
  }
}

/* ---------- requests ---------- */

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

function headers(key: string) {
  return { "Content-Type": "application/json", "x-goog-api-key": key };
}

/** The caller's abort signal combined with a per-call timeout. */
function callSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
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
  if (status === 408) {
    return Object.assign(new Error("The AI took too long to answer. Try again."), { status: 504 });
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
  signal?: AbortSignal,
  attempts = 2
): Promise<CallResult> {
  let last: CallResult = { ok: false, status: 0, body: "" };
  for (let i = 1; i <= attempts; i++) {
    void countCall();
    let res: Response;
    try {
      res = await fetch(`${BASE}/${spec.id}:generateContent`, {
        method: "POST",
        headers: headers(key),
        body: payload,
        signal: callSignal(signal),
      });
    } catch (err: any) {
      if (signal?.aborted) throw err; // the browser left — stop the whole chain
      // Timed out: treat as overload and move down the chain.
      last = { ok: false, status: 504, body: "timed out" };
      break;
    }
    if (res.ok) return { ok: true, data: await res.json() };

    const body = await res.text().catch(() => "");
    last = { ok: false, status: res.status, body };
    if (!isTransient(res.status)) break; // a real error — don't spend the chain on it
    // A 429 is a quota decision, not a blip: the same model will say no again, so
    // move to the next model instead of waiting on this one.
    if (res.status === 429) break;
    if (i < attempts) await sleep(600 * i);
  }
  return last;
}

export interface Generated {
  text: string;
  model: string;
  /** True when the tier's first-choice model did not answer. */
  fallback: boolean;
}

async function generate(
  system: string,
  user: string,
  maxTokens: number,
  tier: Tier,
  schema?: Record<string, any>,
  signal?: AbortSignal
): Promise<Generated> {
  const key = process.env.GEMINI_API_KEY!;
  const { models, thinking } = chainFor(tier);
  let lastStatus = 0;
  let lastBody = "";

  for (const [index, spec] of models.entries()) {
    const payload = requestBody(spec, system, user, maxTokens, thinking, schema);
    const result = await callModel(spec, payload, key, signal);

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
    if (text) return { text, model: spec.id, fallback: index > 0 };

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
  tier: Tier = "standard",
  signal?: AbortSignal
): Promise<string> {
  return (await generate(system, user, maxTokens, tier, undefined, signal)).text;
}

/** Schema-enforced JSON. Throws only once every model in the chain has failed. */
export async function geminiJson(
  system: string,
  user: string,
  maxTokens: number,
  schema: Record<string, any>,
  tier: Tier = "standard",
  signal?: AbortSignal
): Promise<{ json: string; model: string; fallback: boolean }> {
  const { text: raw, model, fallback } = await generate(
    system,
    user,
    maxTokens,
    tier,
    schema,
    signal
  );
  const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    JSON.parse(candidate);
  } catch {
    console.error("[gemini] unparseable JSON", { model, preview: candidate.slice(0, 200) });
    throw new Error("The AI returned malformed data. Try again.");
  }
  return { json: candidate, model, fallback };
}

/**
 * Stream trailer. Every stream ends with exactly one marker line, which
 * lib/aiClient.ts strips before the text reaches a page:
 *   [[CP_META:{"model":…,"fallback":…,"finish":"STOP"}]]   ended normally
 *   [[CP_META:{…,"finish":"MAX_TOKENS"}]]                  cut off — incomplete
 *   [[CP_ERROR:message]]                                   failed
 * A stream with no marker at all was cut off in transit, and is incomplete too.
 * Errors used to arrive as ordinary text with HTTP 200, so a page could save
 * "[AI error: …]" as your resume.
 */
export const STREAM_META = "[[CP_META:";
export const STREAM_ERROR = "[[CP_ERROR:";

/**
 * Token-by-token streaming over SSE, with the same model fallback: if the first
 * model is overloaded we switch before anything has been emitted.
 */
export function geminiStream(
  system: string,
  user: string,
  maxTokens: number,
  tier: Tier = "standard",
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const key = process.env.GEMINI_API_KEY!;
  const { models, thinking } = chainFor(tier);
  const encoder = new TextEncoder();
  // Cancelled when the browser disconnects, so an abandoned stream stops
  // spending quota instead of running to the end for nobody.
  const upstream = new AbortController();
  signal?.addEventListener("abort", () => upstream.abort());

  return new ReadableStream({
    async start(controller) {
      let emitted = false;
      let lastStatus = 0;
      const fail = (message: string) => {
        controller.enqueue(encoder.encode(`\n\n${STREAM_ERROR}${message.replace(/\]\]/g, "]")}]]`));
        controller.close();
      };

      for (const [index, spec] of models.entries()) {
        if (emitted) break;
        let finish = "";
        try {
          void countCall();
          const res = await fetch(`${BASE}/${spec.id}:streamGenerateContent?alt=sse`, {
            method: "POST",
            headers: headers(key),
            body: requestBody(spec, system, user, maxTokens, thinking),
            signal: callSignal(upstream.signal),
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
                const cand = json?.candidates?.[0];
                if (cand?.finishReason) finish = cand.finishReason;
                if (json?.promptFeedback?.blockReason) finish = json.promptFeedback.blockReason;
                const chunk = cand?.content?.parts?.map((p: any) => p.text || "").join("") || "";
                if (chunk) {
                  emitted = true;
                  controller.enqueue(encoder.encode(chunk));
                }
              } catch {
                /* partial frame — the next read completes it */
              }
            }
          }

          if (emitted) {
            const meta = { model: spec.id, fallback: index > 0, finish: finish || "STOP" };
            controller.enqueue(encoder.encode(`\n${STREAM_META}${JSON.stringify(meta)}]]`));
            controller.close();
            return;
          }
          // Connected but produced nothing (blocked, or thinking ate the budget):
          // worth one attempt on the next model down.
          console.error("[gemini] empty stream, falling back", { model: spec.id, finish });
        } catch (err: any) {
          if (upstream.signal.aborted) {
            controller.close();
            return;
          }
          console.error("[gemini] stream failed", { model: spec.id, err: err?.message });
          if (emitted) {
            // Part of the text is already on the user's screen; mark it cut off.
            const meta = { model: spec.id, fallback: index > 0, finish: "ERROR" };
            controller.enqueue(encoder.encode(`\n${STREAM_META}${JSON.stringify(meta)}]]`));
            controller.close();
            return;
          }
          return fail(err?.message || "The AI request failed.");
        }
      }

      fail(
        lastStatus === 429
          ? "Every AI model is rate-limited right now — the free tier resets daily. Try again shortly."
          : "Every AI model is busy right now. Please try again in a moment."
      );
    },
    cancel() {
      upstream.abort();
    },
  });
}
