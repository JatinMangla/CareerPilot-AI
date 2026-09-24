import {
  casWrite,
  deleteField,
  kvConfigured,
  readAll,
  readFieldsWithRev,
  readRevisions,
  writeUnguarded,
} from "@/lib/kv";
import { requireSession } from "@/lib/session";
import { resolveWrite, type Envelope, type IncomingEntry } from "@/lib/syncMerge";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Cross-device sync. The merge rules live in lib/syncMerge.ts.
 *
 * GET ?revs=1        → { revs: { key: revision } } — cheap; this is what a
 *                      focus/refresh asks first, so an unchanged account costs
 *                      one small read instead of downloading every inbox mail.
 * GET ?keys=a,b      → those keys' values, timestamps and revisions.
 * GET                → everything (clients from before revisions).
 * POST { data }      → per key: a list patch or a whole value, plus the revision
 *                      the device last saw. Answers each key's new revision, and
 *                      the merged value where it differs from what was sent.
 *                      POST rather than PUT: this deployment 405s on PUT.
 */

function parseEnvelope(raw: string | null): Envelope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "at" in parsed && "value" in parsed) {
      return parsed as Envelope;
    }
    return { value: parsed, at: 0 };
  } catch {
    return null; // corrupt: treat as absent
  }
}

export async function GET(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  if (!kvConfigured()) {
    return Response.json({ configured: false, data: {}, revs: {} });
  }
  const params = new URL(req.url).searchParams;
  try {
    if (params.get("revs")) {
      return Response.json({ configured: true, revs: await readRevisions() });
    }

    const keysParam = params.get("keys");
    if (keysParam) {
      const keys = keysParam.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 64);
      const rows = await readFieldsWithRev(keys);
      const data: Record<string, Envelope & { rev: number }> = {};
      for (const [k, { raw, rev }] of Object.entries(rows)) {
        const env = parseEnvelope(raw);
        if (env) data[k] = { value: env.value, at: env.at, rev };
      }
      return Response.json({ configured: true, data });
    }

    const raw = await readAll();
    const data: Record<string, Envelope> = {};
    for (const [k, v] of Object.entries(raw)) {
      const env = parseEnvelope(v);
      if (env) data[k] = { value: env.value, at: env.at };
    }
    return Response.json({ configured: true, data });
  } catch (err: any) {
    return Response.json({ configured: true, error: err.message }, { status: 502 });
  }
}

/** Removes one key from cloud storage: DELETE /api/state?key=cp_jobs */
export async function DELETE(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  if (!kvConfigured()) {
    return Response.json({ error: "No database connected." }, { status: 503 });
  }
  const key = new URL(req.url).searchParams.get("key");
  if (!key) {
    return Response.json({ error: "A ?key= parameter is required." }, { status: 400 });
  }
  try {
    const removed = await deleteField(key);
    return Response.json({ ok: true, removed });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}

interface KeyResult {
  rev: number;
  at: number;
  value?: unknown;
}

/** Attempts before giving up on a write that keeps losing races. */
const CAS_ATTEMPTS = 4;

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
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

  const incoming: Record<string, IncomingEntry> = body?.data || {};
  const keys = Object.keys(incoming).filter(
    (k) => incoming[k] && typeof incoming[k].at === "number"
  );
  if (!keys.length) return Response.json({ ok: true, written: 0, results: {} });

  try {
    for (let attempt = 1; attempt <= CAS_ATTEMPTS; attempt++) {
      const now = Date.now();
      const current = await readFieldsWithRev(keys);
      const results: Record<string, KeyResult> = {};
      const writes: { field: string; expectedRev: number; value: string }[] = [];

      for (const key of keys) {
        const { raw, rev } = current[key];
        const stored = parseEnvelope(raw);
        const res = resolveWrite(key, incoming[key], stored, rev, now);
        if (res.write) {
          writes.push({ field: key, expectedRev: rev, value: JSON.stringify(res.write) });
          results[key] = { rev: rev + 1, at: res.write.at };
        } else {
          results[key] = { rev, at: stored?.at ?? 0 };
        }
        if (res.adopt) {
          results[key].value = res.adopt.value;
          results[key].at = res.adopt.at;
        }
      }

      let revs: Record<string, number> | null;
      try {
        revs = await casWrite(writes);
      } catch (err: any) {
        // EVAL unavailable (a Redis without Lua): write without the guard rather
        // than stop syncing. Rare races then fall back to the old behaviour.
        console.error("[state] atomic write unavailable, writing unguarded", err?.message);
        revs = await writeUnguarded(writes);
      }

      if (revs) {
        for (const [k, r] of Object.entries(revs)) results[k].rev = r;
        return Response.json({ ok: true, written: writes.length, results });
      }
      // Another device wrote in between: re-read and merge again.
    }
    return Response.json(
      { error: "Another device kept writing at the same moment — this will retry." },
      { status: 409 }
    );
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
