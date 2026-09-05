/**
 * Tiny Upstash Redis client over their REST API — plain fetch, no SDK.
 *
 * Works with either env var pair:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Upstash direct)
 *   KV_REST_API_URL        / KV_REST_API_TOKEN         (Vercel Marketplace)
 *
 * All CareerPilot state lives in one Redis hash, one field per store key.
 */

const HASH = "careerpilot:state";

function creds(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function kvConfigured(): boolean {
  return creds() !== null;
}

async function command(cmd: (string | number)[]): Promise<any> {
  const c = creds();
  if (!c) throw new Error("KV not configured");
  const res = await fetch(c.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`KV error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  if (data?.error) throw new Error(`KV error: ${data.error}`);
  return data?.result;
}

async function pipeline(cmds: (string | number)[][]): Promise<any[]> {
  const c = creds();
  if (!c) throw new Error("KV not configured");
  const res = await fetch(`${c.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmds),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`KV error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // Upstash returns HTTP 200 with a per-command result array — an individual
  // command can carry {error} while the envelope looks fine. Without this check
  // a failed write is reported all the way up the stack as a success.
  const results = await res.json();
  if (Array.isArray(results)) {
    const failed = results.filter((r) => r && typeof r === "object" && r.error);
    if (failed.length) {
      throw new Error(
        `KV write failed for ${failed.length}/${results.length} command(s): ${String(
          failed[0].error
        ).slice(0, 200)}`
      );
    }
  }
  return results;
}

/** Every stored key → its raw JSON string. */
export async function readAll(): Promise<Record<string, string>> {
  const flat = await command(["HGETALL", HASH]);
  const out: Record<string, string> = {};
  if (Array.isArray(flat)) {
    // Upstash returns [field, value, field, value, …]
    for (let i = 0; i < flat.length; i += 2) out[String(flat[i])] = String(flat[i + 1]);
  } else if (flat && typeof flat === "object") {
    for (const [k, v] of Object.entries(flat)) out[k] = String(v);
  }
  return out;
}

/** Writes the given fields (values already JSON-stringified). */
export async function writeFields(fields: Record<string, string>): Promise<void> {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  await pipeline(entries.map(([k, v]) => ["HSET", HASH, k, v]));
}

/** Removes a single stored key. */
export async function deleteField(field: string): Promise<number> {
  return (await command(["HDEL", HASH, field])) as number;
}

/* ---------- generic hash helpers ---------- */

/** HGETALL on an arbitrary hash, returned as a flat string map. */
export async function hgetallRaw(key: string): Promise<Record<string, string>> {
  const flat = await command(["HGETALL", key]);
  const out: Record<string, string> = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i < flat.length; i += 2) out[String(flat[i])] = String(flat[i + 1]);
  } else if (flat && typeof flat === "object") {
    for (const [k, v] of Object.entries(flat)) out[k] = String(v);
  }
  return out;
}

/** Atomically increments several float fields of a hash. */
export async function hincrbyFloat(
  key: string,
  fields: [string, number][]
): Promise<void> {
  if (!fields.length) return;
  await pipeline(fields.map(([f, by]) => ["HINCRBYFLOAT", key, f, by]));
}

export async function expire(key: string, seconds: number): Promise<void> {
  await command(["EXPIRE", key, seconds]);
}

/** Increments a counter and ensures it expires, returning the new value. */
export async function incrWithExpiry(key: string, ttlSec: number): Promise<number> {
  const [count] = await pipeline([
    ["INCR", key],
    ["EXPIRE", key, ttlSec],
  ]);
  return Number(typeof count === "object" ? count?.result : count) || 0;
}

/**
 * Plain expiring string keys, outside the state hash.
 *
 * Everything else here lives in one hash because it is all user state that syncs
 * together. The AI response cache is not user state — it is disposable, it must
 * expire on its own, and it must never be picked up by readAll() and pushed into
 * a browser. So it gets its own top-level keys.
 */
export async function getString(key: string): Promise<string | null> {
  const value = await command(["GET", key]);
  return typeof value === "string" ? value : null;
}

export async function setString(key: string, value: string, ttlSec: number): Promise<void> {
  await command(["SET", key, value, "EX", ttlSec]);
}

export async function clearAll(): Promise<void> {
  await command(["DEL", HASH]);
}
