/**
 * Free-tier fallback AI provider (Google Gemini) — used only when
 * ANTHROPIC_API_KEY is not set but GEMINI_API_KEY is.
 * Claude (Anthropic) remains the primary, higher-quality provider.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function model(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

async function generate(
  system: string,
  user: string,
  maxTokens: number,
  jsonSchema?: Record<string, any>
): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const userText = jsonSchema
    ? `${user}\n\nRespond with ONLY a single valid JSON object (no markdown fences, no commentary) that matches this JSON schema exactly:\n${JSON.stringify(jsonSchema)}`
    : user;

  const res = await fetch(`${BASE}/${model()}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(jsonSchema ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) {
      throw Object.assign(
        new Error("Gemini free-tier rate limit hit — wait a minute and retry (or add ANTHROPIC_API_KEY for the full experience)."),
        { status: 429 }
      );
    }
    throw Object.assign(new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`), {
      status: res.status,
    });
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("") || "";
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new Error(`Gemini returned no text${reason ? ` (${reason})` : ""}`);
  }
  return text;
}

export async function geminiText(
  system: string,
  user: string,
  maxTokens: number
): Promise<string> {
  return generate(system, user, maxTokens);
}

export async function geminiJson(
  system: string,
  user: string,
  maxTokens: number,
  schema: Record<string, any>
): Promise<string> {
  const raw = await generate(system, user, maxTokens, schema);
  // strip accidental fences / leading prose, keep the outermost JSON object
  const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  JSON.parse(candidate); // throws if invalid — caller surfaces a clean error
  return candidate;
}
