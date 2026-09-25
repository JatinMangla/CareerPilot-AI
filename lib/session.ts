import { cookies } from "next/headers";

import { readSession, SESSION_COOKIE, SESSION_MAX_AGE_MS, type SessionInfo } from "./auth";
import { getMany, getString, incr, kvConfigured, setString } from "./kv";

/**
 * Session revocation, checked by the API routes on top of middleware.
 *
 * A session cookie is a signed bearer token: before this, logging out only
 * deleted the browser's copy, and a stolen cookie stayed valid for 30 days. Two
 * server-side records fix that:
 *   - `cp:session:revoked:<sig>` — this one session, set by "Sign out"
 *   - `cp:session:epoch`         — "sign out everywhere"; every token carries the
 *                                  epoch it was issued under and dies when it moves
 *
 * Middleware stays stateless (a Redis round trip on every page load buys little:
 * pages hold no data until they call these routes). The routes are where the
 * mailbox, the outbox and the synced state actually are, so they check here too.
 */

const EPOCH_KEY = "cp:session:epoch";
const revokedKey = (sig: string) => `cp:session:revoked:${sig}`;

export async function currentEpoch(): Promise<number> {
  if (!kvConfigured()) return 0;
  try {
    return Number(await getString(EPOCH_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Returns a 401 response to send back, or null when the session is good. */
export async function requireSession(): Promise<Response | null> {
  const denied = () => Response.json({ error: "Not authenticated" }, { status: 401 });
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return denied();
  if (!kvConfigured()) return null;

  try {
    const [epoch, revoked] = await getMany([EPOCH_KEY, revokedKey(session.sig)]);
    if (revoked) return denied();
    if ((Number(epoch) || 0) !== session.epoch) return denied();
  } catch (err) {
    // Middleware has already verified the signature and age. A Redis outage
    // should not lock the owner out of their own app.
    console.error("[session] revocation check failed, allowing", (err as Error)?.message);
  }
  return null;
}

/** Revokes one session until it would have expired anyway. */
export async function revokeSession(session: SessionInfo): Promise<void> {
  if (!kvConfigured()) return;
  const ttl = Math.ceil((session.issuedAt + SESSION_MAX_AGE_MS - Date.now()) / 1000);
  if (ttl > 0) await setString(revokedKey(session.sig), "1", ttl);
}

/** Invalidates every session issued so far, on every device. */
export async function revokeAllSessions(): Promise<void> {
  if (!kvConfigured()) return;
  await incr(EPOCH_KEY);
}
