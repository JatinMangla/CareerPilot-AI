import { cookies } from "next/headers";
import { OTP_COOKIE, ownerEmail } from "@/lib/auth";
import { kvConfigured } from "@/lib/kv";
import { sendOwnerMail } from "@/lib/mail";
import { issueOtp, OTP_TTL_SEC } from "@/lib/otp";
import { rateLimit, rateLimitPair } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * Most codes in a day. Each one allows five guesses, so the 15-minute limits alone
 * still gave anyone patient 4,800 guesses a day at a 900,000-value code, about
 * 0.5%. This caps it at 150. Reaching it locks the email route for the day, and
 * password sign-in is the way in if someone spends it on purpose.
 */
const DAILY_CODE_LIMIT = 30;

/**
 * Emails a 6-digit login code to the owner's email via Resend.
 * The code's hash lives in Redis (lib/otp.ts); the browser holds only a nonce.
 *
 * This route is public, so what it says goes to anyone. Configuration and the
 * owner's address stay in the server log.
 */
export async function POST(req: Request) {
  const unavailable = () =>
    Response.json(
      { error: "Email codes aren't available right now. Sign in with your password instead." },
      { status: 503 }
    );

  if (!process.env.RESEND_API_KEY) {
    console.error("[auth/forgot] RESEND_API_KEY is not set");
    return unavailable();
  }
  let email: string;
  try {
    email = ownerEmail();
  } catch (err) {
    console.error("[auth/forgot]", (err as Error).message);
    return unavailable();
  }

  // Without Redis there is nowhere the client cannot tamper with to count
  // guesses, and a 6-digit code without an attempt limit is brute-forceable.
  if (!kvConfigured()) {
    console.error("[auth/forgot] Redis is not configured");
    return unavailable();
  }

  // Unauthenticated, and every call emails the owner: per-IP so one client
  // cannot mailbomb, plus a global ceiling so many clients cannot either.
  let limited = await rateLimitPair(req, "otp-send", 5, 10, 60 * 15, { failClosed: true });
  if (limited.allowed) {
    limited = await rateLimit("otp-send-day", DAILY_CODE_LIMIT, 60 * 60 * 24, { failClosed: true });
  }
  if (!limited.allowed) {
    return Response.json(
      {
        error:
          "Too many login codes requested. Check your inbox (and spam), then try again in a few minutes.",
      },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  // Short client-side cooldown purely for UX (stops double-clicks).
  if ((await cookies()).get("cp_otp_cooldown")) {
    return Response.json(
      { error: "A code was just sent — check your inbox (and spam). You can request another in a minute." },
      { status: 429 }
    );
  }

  const { code, nonce } = await issueOtp();

  const sent = await sendOwnerMail(
    email,
    `${code} is your CareerPilot login code`,
    `
        <div style="font-family:Arial,sans-serif;max-width:440px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 8px">CareerPilot AI</h2>
          <p style="color:#555">Use this code to sign in. It expires in 10 minutes and works once.</p>
          <div style="font-size:34px;font-weight:bold;letter-spacing:8px;background:#f4f6f5;border-radius:12px;padding:18px;text-align:center">${code}</div>
          <p style="color:#999;font-size:12px;margin-top:16px">If you didn't request this, you can ignore it — only this code (not your password) was sent.</p>
        </div>`
  );

  if (!sent.ok) {
    // The likely cause on a free Resend account is 403: it only delivers to the
    // address that registered it. Said in the log, because the old message put
    // the owner's full email in a response anyone could trigger.
    console.error("[auth/forgot] email failed", { status: sent.status, detail: sent.detail });
    return Response.json(
      { error: "The login code couldn't be sent. Try again, or sign in with your password." },
      { status: 502 }
    );
  }

  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(OTP_COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: OTP_TTL_SEC });
  jar.set("cp_otp_cooldown", "1", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 });

  return Response.json({ ok: true, sentTo: email.replace(/(.{3}).+(@.+)/, "$1***$2") });
}
