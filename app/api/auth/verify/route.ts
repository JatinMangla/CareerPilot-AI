import { cookies } from "next/headers";
import {
  createSessionToken,
  verifyOtpToken,
  SESSION_COOKIE,
  OTP_COOKIE,
} from "@/lib/auth";

export const runtime = "nodejs";

/** Verifies the emailed 6-digit code and issues a session. */
export async function POST(req: Request) {
  const { code } = await req.json().catch(() => ({}));
  const jar = cookies();
  const otpToken = jar.get(OTP_COOKIE)?.value;

  const valid =
    typeof code === "string" && (await verifyOtpToken(otpToken, code));
  if (!valid) {
    return Response.json(
      { error: "Invalid or expired code. Request a new one." },
      { status: 401 }
    );
  }

  const email = (process.env.AUTH_EMAIL || "jatinmangla123@gmail.com").trim().toLowerCase();
  jar.set(SESSION_COOKIE, await createSessionToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  jar.delete(OTP_COOKIE);
  return Response.json({ ok: true });
}
