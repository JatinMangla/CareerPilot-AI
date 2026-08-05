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
  return res.json();
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

export async function clearAll(): Promise<void> {
  await command(["DEL", HASH]);
}
