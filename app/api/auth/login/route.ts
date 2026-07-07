import { cookies } from "next/headers";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
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
