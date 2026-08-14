import { kvConfigured, incrWithExpiry } from "./kv";

/**
 * Server-side rate limiting for the unauthenticated auth endpoints.
 *
 * The previous cooldown lived in a cookie, which an attacker simply doesn't
 * send. This one is stored server-side so it can't be opted out of.
 *
 * Fails open when no database is configured — the app must still work locally —
 * but that is only ever the case for a deployment without Redis.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export async function rateLimit(
  bucket: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  if (!kvConfigured()) {
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }
  try {
    const slot = Math.floor(Date.now() / 1000 / windowSec);
    const count = await incrWithExpiry(`careerpilot:rl:${bucket}:${slot}`, windowSec * 2);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: windowSec,
    };
  } catch (err) {
    console.error("[rateLimit] check failed, allowing request", err);
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }
}
