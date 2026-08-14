import { cookies } from "next/headers";
import {
  createSessionToken,
  verifyOtpToken,
  bumpOtpAttempts,
  OTP_MAX_ATTEMPTS,
  SESSION_COOKIE,
  OTP_COOKIE,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** Verifies the emailed 6-digit code and issues a session. */
export async function POST(req: Request) {
  const limited = await rateLimit("otp-verify", 20, 60 * 10);
  if (!limited.allowed) {
    return Response.json(
      { error: "Too many attempts. Request a new code in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  const { code } = await req.json().catch(() => ({}));
  const jar = cookies();
  const otpToken = jar.get(OTP_COOKIE)?.value;

  const result =
    typeof code === "string"
      ? await verifyOtpToken(otpToken, code)
      : ({ ok: false, reason: "invalid", attempts: 0 } as const);

  if (!result.ok) {
    if (result.reason === "locked" || result.reason === "expired") {
      jar.delete(OTP_COOKIE);
      return Response.json(
        {
          error:
            result.reason === "locked"
              ? "Too many incorrect attempts. Request a new code."
              : "That code expired. Request a new one.",
        },
        { status: 401 }
      );
    }

    // Wrong code: persist the incremented attempt count so guessing runs out.
    const bumped = otpToken ? await bumpOtpAttempts(otpToken, result.attempts) : null;
    if (bumped && result.attempts > 0) {
      jar.set(OTP_COOKIE, bumped, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 600,
      });
      const left = Math.max(0, OTP_MAX_ATTEMPTS - result.attempts);
      return Response.json(
        { error: `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` },
        { status: 401 }
      );
    }
    return Response.json({ error: "Invalid code. Request a new one." }, { status: 401 });
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
