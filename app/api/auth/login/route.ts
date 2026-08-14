import { cookies } from "next/headers";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Unauthenticated endpoint — cap guesses against the password.
  const limited = await rateLimit("login", 10, 60 * 10);
  if (!limited.allowed) {
    return Response.json(
      { error: "Too many sign-in attempts. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const { email, password } = await req.json().catch(() => ({}));

  const allowedEmail = (process.env.AUTH_EMAIL || "jatinmangla123@gmail.com")
    .trim()
    .toLowerCase();
  const allowedPassword = (process.env.AUTH_PASSWORD || "careerpilot").trim();

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim().toLowerCase() !== allowedEmail ||
    password.trim() !== allowedPassword
  ) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = await createSessionToken(email.trim().toLowerCase());
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return Response.json({ ok: true });
}
