import { cookies } from "next/headers";
import { createSessionToken, ownerEmail, secretsEqual, SESSION_COOKIE } from "@/lib/auth";
import { rateLimitPair } from "@/lib/rateLimit";
import { currentEpoch } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Unauthenticated endpoint — cap guesses against the password. Fails open when
  // Redis is down: this is the way in when everything else is broken, and a
  // strong password is the real control here.
  const limited = await rateLimitPair(req, "login", 10, 50, 60 * 10);
  if (!limited.allowed) {
    return Response.json(
      { error: "Too many sign-in attempts. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  /*
   * No default password. There used to be one for when AUTH_PASSWORD was unset,
   * and it is in the public repo — a deployment that lost the variable would have
   * accepted it. Local dev has no password until you set one in .env.local.
   */
  const allowedPassword = (process.env.AUTH_PASSWORD || "").trim();
  let allowedEmail: string;
  try {
    allowedEmail = ownerEmail();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!allowedPassword) {
    return Response.json(
      { error: "Password sign-in is off: AUTH_PASSWORD is not set. Use the email code instead." },
      { status: 503 }
    );
  }

  const { email, password } = await req.json().catch(() => ({}));
  const ok =
    typeof email === "string" &&
    typeof password === "string" &&
    // Both compared, always, so the response time says nothing about which failed.
    (await secretsEqual(email.trim().toLowerCase(), allowedEmail)) &&
    (await secretsEqual(password.trim(), allowedPassword));
  if (!ok) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = await createSessionToken(allowedEmail, await currentEpoch());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return Response.json({ ok: true });
}
