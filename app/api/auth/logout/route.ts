import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@/lib/auth";
import { revokeAllSessions, revokeSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Signs out. Deleting the cookie alone left the token valid for anyone holding a
 * copy, so the session is revoked server-side too. `{ everywhere: true }` ends
 * every session on every device.
 */
export async function POST(req: Request) {
  const { everywhere } = await req.json().catch(() => ({}));
  const jar = cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);

  try {
    if (everywhere === true && session) await revokeAllSessions();
    else if (session) await revokeSession(session);
  } catch (err) {
    console.error("[auth/logout] revocation failed", (err as Error)?.message);
    jar.delete(SESSION_COOKIE);
    return Response.json(
      { ok: false, error: "Signed out here, but other copies of this session couldn't be revoked." },
      { status: 502 }
    );
  }

  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
