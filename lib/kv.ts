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
/**
 * One counter per state field, bumped on every write. Kept in its own hash so
 * reading every revision is cheap — the state hash holds whole inboxes.
 */
const REV_HASH = "careerpilot:rev";

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

/** Removes a single stored key, and its revision with it. */
export async function deleteField(field: string): Promise<number> {
  const [removed] = await pipeline([
    ["HDEL", HASH, field],
    ["HDEL", REV_HASH, field],
  ]);
  return Number(removed?.result) || 0;
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

/* ---------- revisioned state (cross-device sync) ---------- */

/** Field → revision. A field that predates revisions is given revision 1. */
export async function readRevisions(): Promise<Record<string, number>> {
  const [fields, revs] = await pipeline([
    ["HKEYS", HASH],
    ["HGETALL", REV_HASH],
  ]);
  const names: string[] = Array.isArray(fields?.result) ? fields.result.map(String) : [];
  const flat: unknown[] = Array.isArray(revs?.result) ? revs.result : [];
  const out: Record<string, number> = {};
  for (let i = 0; i < flat.length; i += 2) out[String(flat[i])] = Number(flat[i + 1]) || 0;

  const missing = names.filter((n) => !(n in out));
  if (missing.length) {
    // One-time migration for data written before revisions existed. HSETNX, so
    // a write racing this cannot be rolled back to 1.
    await pipeline(missing.map((f) => ["HSETNX", REV_HASH, f, 1]));
    for (const f of missing) out[f] = out[f] ?? 1;
  }
  for (const f of Object.keys(out)) if (!names.includes(f)) delete out[f];
  return out;
}

/** Raw stored values and revisions for some fields. */
export async function readFieldsWithRev(
  fields: string[]
): Promise<Record<string, { raw: string | null; rev: number }>> {
  const out: Record<string, { raw: string | null; rev: number }> = {};
  if (!fields.length) return out;
  const [vals, revs] = await pipeline([
    ["HMGET", HASH, ...fields],
    ["HMGET", REV_HASH, ...fields],
  ]);
  fields.forEach((f, i) => {
    const raw = vals?.result?.[i];
    out[f] = { raw: typeof raw === "string" ? raw : null, rev: Number(revs?.result?.[i]) || 0 };
  });
  return out;
}

/**
 * Writes fields only if none changed since they were read, then bumps their
 * revisions — atomically, in one Lua call. Returns the new revisions, or null
 * when another write got in first (the caller re-reads and retries).
 */
const CAS_SCRIPT = `
local n = tonumber(ARGV[1])
for i = 0, n - 1 do
  local cur = tonumber(redis.call('HGET', KEYS[2], ARGV[2 + i * 3]) or '0') or 0
  if cur ~= tonumber(ARGV[3 + i * 3]) then return {0} end
end
local out = {1}
for i = 0, n - 1 do
  local f = ARGV[2 + i * 3]
  redis.call('HSET', KEYS[1], f, ARGV[4 + i * 3])
  out[#out + 1] = redis.call('HINCRBY', KEYS[2], f, 1)
end
return out`;

export async function casWrite(
  writes: { field: string; expectedRev: number; value: string }[]
): Promise<Record<string, number> | null> {
  if (!writes.length) return {};
  const args: (string | number)[] = [writes.length];
  for (const w of writes) args.push(w.field, w.expectedRev, w.value);
  const res = await command(["EVAL", CAS_SCRIPT, 2, HASH, REV_HASH, ...args]);
  if (!Array.isArray(res) || Number(res[0]) !== 1) return null;
  const revs: Record<string, number> = {};
  writes.forEach((w, i) => (revs[w.field] = Number(res[i + 1]) || w.expectedRev + 1));
  return revs;
}

/** casWrite without the guard, for a Redis that cannot run Lua. Still bumps revisions. */
export async function writeUnguarded(
  writes: { field: string; value: string }[]
): Promise<Record<string, number>> {
  if (!writes.length) return {};
  const res = await pipeline(
    writes.flatMap((w) => [
      ["HSET", HASH, w.field, w.value],
      ["HINCRBY", REV_HASH, w.field, 1],
    ])
  );
  const revs: Record<string, number> = {};
  writes.forEach((w, i) => (revs[w.field] = Number(res[i * 2 + 1]?.result) || 0));
  return revs;
}

/** Several plain keys in one round trip; a missing key comes back null. */
export async function getMany(keys: string[]): Promise<(string | null)[]> {
  if (!keys.length) return [];
  const values = await command(["MGET", ...keys]);
  return (Array.isArray(values) ? values : []).map((v) => (typeof v === "string" ? v : null));
}

export async function deleteKey(key: string): Promise<void> {
  await command(["DEL", key]);
}

export async function incr(key: string): Promise<number> {
  return Number(await command(["INCR", key])) || 0;
}

export async function clearAll(): Promise<void> {
  await command(["DEL", HASH, REV_HASH]);
}
