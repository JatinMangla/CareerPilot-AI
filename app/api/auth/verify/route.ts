import { cookies } from "next/headers";
import { createSessionToken, ownerEmail, SESSION_COOKIE, OTP_COOKIE } from "@/lib/auth";
import { sendOwnerMail } from "@/lib/mail";
import { verifyOtp } from "@/lib/otp";
import { rateLimit, rateLimitPair } from "@/lib/rateLimit";
import { currentEpoch } from "@/lib/session";

export const runtime = "nodejs";

/** Wrong codes in a day before the owner is emailed about it. */
const DAILY_FAILURE_ALERT = 15;

/** Verifies the emailed 6-digit code and issues a session. */
export async function POST(req: Request) {
  const limited = await rateLimitPair(req, "otp-verify", 20, 60, 60 * 10, { failClosed: true });
  if (!limited.allowed) {
    return Response.json(
      { error: "Too many attempts. Request a new code in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  let email: string;
  try {
    email = ownerEmail();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const { code } = await req.json().catch(() => ({}));
  const jar = await cookies();

  let result;
  try {
    result =
      typeof code === "string"
        ? await verifyOtp(jar.get(OTP_COOKIE)?.value, code)
        : ({ ok: false, reason: "invalid", attemptsLeft: 0 } as const);
  } catch (err) {
    console.error("[auth/verify] code store unavailable", (err as Error)?.message);
    return Response.json(
      { error: "Couldn't check the code right now. Try again, or sign in with your password." },
      { status: 503 }
    );
  }

  if (!result.ok) {
    await noteFailure(email);
    if (result.reason === "locked" || result.reason === "expired") {
      jar.delete(OTP_COOKIE);
      return Response.json(
        {
          error:
            result.reason === "locked"
              ? "Too many incorrect attempts. Request a new code."
              : "That code expired or was already used. Request a new one.",
        },
        { status: 401 }
      );
    }
    const left = result.attemptsLeft;
    return Response.json(
      {
        error:
          left > 0
            ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.`
            : "Incorrect code. Request a new one.",
      },
      { status: 401 }
    );
  }

  jar.set(SESSION_COOKIE, await createSessionToken(email, await currentEpoch()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  jar.delete(OTP_COOKIE);
  return Response.json({ ok: true });
}

/**
 * Counts wrong codes per day and emails the owner once when it crosses the
 * alert line — someone guessing at the login is worth knowing about, and the
 * per-code limit alone would never surface it.
 */
async function noteFailure(email: string) {
  const day = await rateLimit("otp-fail-day", DAILY_FAILURE_ALERT, 60 * 60 * 24);
  if (day.count !== DAILY_FAILURE_ALERT + 1) return;
  await sendOwnerMail(
    email,
    "CareerPilot: repeated wrong login codes",
    `<div style="font-family:Arial,sans-serif;max-width:480px;padding:24px">
      <p>More than ${DAILY_FAILURE_ALERT} wrong login codes were entered for your CareerPilot account today.</p>
      <p>If that wasn't you, rotate <b>AUTH_SECRET</b> in Vercel, which signs everyone out, and change <b>AUTH_PASSWORD</b>.</p>
    </div>`
  ).catch(() => {});
}
