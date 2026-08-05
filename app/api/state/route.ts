import { kvConfigured, readAll, writeFields } from "@/lib/kv";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Cross-device state sync.
 *
 * GET  → everything stored for this account, plus per-key timestamps.
 * POST → merges the posted keys in (last-write-wins per key, by timestamp).
 *        POST rather than PUT because some edge firewalls drop uncommon verbs.
 *
 * The browser keeps localStorage as an instant cache; this is the source of
 * truth that makes the phone, iPad and laptop show the same thing.
 */

interface Envelope {
  value: unknown;
  at: number;
}

export async function GET() {
  if (!kvConfigured()) {
    return Response.json({ configured: false, data: {} });
  }
  try {
    const raw = await readAll();
    const data: Record<string, Envelope> = {};
    for (const [k, v] of Object.entries(raw)) {
      try {
        const parsed = JSON.parse(v);
        if (parsed && typeof parsed === "object" && "at" in parsed && "value" in parsed) {
          data[k] = parsed as Envelope;
        } else {
          data[k] = { value: parsed, at: 0 };
        }
      } catch {
        /* skip corrupt field */
      }
    }
    return Response.json({ configured: true, data });
  } catch (err: any) {
    return Response.json({ configured: true, error: err.message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  if (!kvConfigured()) {
    return Response.json(
      {
        configured: false,
        error:
          "No database connected. Create a free Upstash Redis store and add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to this project.",
      },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const incoming: Record<string, Envelope> = body?.data || {};
  const keys = Object.keys(incoming);
  if (!keys.length) return Response.json({ ok: true, written: 0 });

  try {
    // Only overwrite a field if what we're given is newer than what's stored.
    const existing = await readAll();
    const toWrite: Record<string, string> = {};

    for (const key of keys) {
      const next = incoming[key];
      if (!next || typeof next.at !== "number") continue;
      let currentAt = -1;
      try {
        const cur = existing[key] ? JSON.parse(existing[key]) : null;
        if (cur && typeof cur.at === "number") currentAt = cur.at;
      } catch {
        /* treat corrupt as absent */
      }
      if (next.at > currentAt) {
        toWrite[key] = JSON.stringify({ value: next.value, at: next.at });
      }
    }

    await writeFields(toWrite);
    return Response.json({ ok: true, written: Object.keys(toWrite).length });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
