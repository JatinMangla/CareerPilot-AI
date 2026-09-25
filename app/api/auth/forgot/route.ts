import { cookies } from "next/headers";
import { OTP_COOKIE, ownerEmail } from "@/lib/auth";
import { kvConfigured } from "@/lib/kv";
import { sendOwnerMail } from "@/lib/mail";
import { issueOtp, OTP_TTL_SEC } from "@/lib/otp";
import { rateLimitPair } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * Emails a 6-digit login code to the owner's email via Resend.
 * The code's hash lives in Redis (lib/otp.ts); the browser holds only a nonce.
 */
export async function POST(req: Request) {
  if (!process.env.RESEND_API_KEY) {
    return Response.json(
      { error: "RESEND_API_KEY is not configured — cannot send the login code." },
      { status: 500 }
    );
  }
  let email: string;
  try {
    email = ownerEmail();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  // Without Redis there is nowhere the client cannot tamper with to count
  // guesses, and a 6-digit code without an attempt limit is brute-forceable.
  if (!kvConfigured()) {
    return Response.json(
      {
        error:
          "Email-code sign-in needs the Redis database, which keeps the code where it can't be guessed. Sign in with your password, or connect Upstash Redis.",
      },
      { status: 503 }
    );
  }

  // Unauthenticated, and every call emails the owner: per-IP so one client
  // cannot mailbomb, plus a global ceiling so many clients cannot either.
  const limited = await rateLimitPair(req, "otp-send", 5, 10, 60 * 15, { failClosed: true });
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
    return Response.json(
      {
        error: `Email sending failed (Resend ${sent.status}). ${
          sent.status === 403
            ? "Free Resend accounts can only send to the email you registered Resend with — make sure that's " + email + "."
            : sent.detail
        }`,
      },
      { status: 502 }
    );
  }

  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(OTP_COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: OTP_TTL_SEC });
  jar.set("cp_otp_cooldown", "1", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 });

  return Response.json({ ok: true, sentTo: email.replace(/(.{3}).+(@.+)/, "$1***$2") });
}
