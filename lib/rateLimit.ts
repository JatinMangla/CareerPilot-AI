import { kvConfigured, incrWithExpiry } from "./kv";

/**
 * Server-side rate limiting for the unauthenticated auth endpoints.
 *
 * The previous cooldown lived in a cookie, which an attacker simply doesn't
 * send. This one is stored server-side so it can't be opted out of.
 *
 * Buckets are meant to be scoped per client IP (see `clientIp`), with a looser
 * global bucket beside them. A single global bucket let anyone lock the owner
 * out of their own login just by spending it.
 *
 * Fails open by default when no database is configured — the app must still work
 * locally. `failClosed` is for checks that only exist to stop guessing: the email
 * code flow already needs Redis, so a missing or broken Redis must not quietly
 * turn its brute-force limit off.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Requests counted in this window, including this one (0 when unchecked). */
  count: number;
  remaining: number;
  retryAfterSec: number;
}

export async function rateLimit(
  bucket: string,
  limit: number,
  windowSec: number,
  opts: { failClosed?: boolean } = {}
): Promise<RateLimitResult> {
  const unchecked = (allowed: boolean): RateLimitResult => ({
    allowed,
    count: 0,
    remaining: allowed ? limit : 0,
    retryAfterSec: allowed ? 0 : 60,
  });
  if (!kvConfigured()) return unchecked(!opts.failClosed);
  try {
    const slot = Math.floor(Date.now() / 1000 / windowSec);
    const count = await incrWithExpiry(`careerpilot:rl:${bucket}:${slot}`, windowSec * 2);
    return {
      allowed: count <= limit,
      count,
      remaining: Math.max(0, limit - count),
      retryAfterSec: windowSec,
    };
  } catch (err) {
    console.error("[rateLimit] check failed", { bucket, failClosed: !!opts.failClosed, err });
    return unchecked(!opts.failClosed);
  }
}

/**
 * The caller's IP as Vercel reports it. `x-real-ip` is set by Vercel's edge and
 * cannot be supplied by the client; `x-forwarded-for` is the fallback elsewhere.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

/** Checks a per-IP bucket and a global one; the first refusal wins. */
export async function rateLimitPair(
  req: Request,
  name: string,
  perIp: number,
  global: number,
  windowSec: number,
  opts: { failClosed?: boolean } = {}
): Promise<RateLimitResult> {
  const ip = await rateLimit(`${name}:ip:${clientIp(req)}`, perIp, windowSec, opts);
  if (!ip.allowed) return ip;
  return rateLimit(`${name}:all`, global, windowSec, opts);
}
